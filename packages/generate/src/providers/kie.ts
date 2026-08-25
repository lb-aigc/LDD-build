import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 200
const MIN_VIDEO_DURATION = 4
const MAX_VIDEO_DURATION = 30

/**
 * KIE aggregator adapter (https://kie.ai). KIE is a model aggregator with ONE
 * Bearer key and ONE async task protocol covering images (Seedream, GPT Image,
 * Nano Banana, Flux, ...) and videos (Seedance, Kling, Wan, Hailuo, ...). The
 * `model` option is the capability id (e.g. `bytedance/seedance-2-5`,
 * `bytedance/seedream`, `google/nano-banana`), NOT a display name.
 *
 * Protocol (from https://docs.kie.ai):
 *   submit: POST {baseURL}/api/v1/jobs/createTask   { model, input, callBackUrl? }
 *           -> { code: 200, msg, data: { taskId } }
 *   poll:   GET  {baseURL}/api/v1/jobs/recordInfo?taskId=xxx
 *           -> { code: 200, data: { state, resultJson, failCode } }
 *           state in waiting/queuing/generating/success/fail
 *           resultJson (on success) = '{"resultUrls":["https://..."]}'
 *
 * Image `input` carries ONLY `prompt`: each image model names its own size
 * field (`image_size` for Seedream, `aspect_ratio` for GPT Image / Nano Banana,
 * ...), so sending a shared size enum would 422 on the models whose vocabulary
 * differs. The returned width/height are the caller's requested geometry, used
 * purely as result metadata, not as a wire parameter. Video `input` uses the
 * Seedance fields (duration/resolution/aspect_ratio); other video models accept
 * the same core fields.
 */
export class KieProvider implements GenerationProvider {
  readonly id = 'kie'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    const { model } = this.requireCredentials()
    const taskId = await this.submit(signal, model, { prompt: request.prompt })
    const urls = await this.resolveDownloadUrls(await this.poll(signal, taskId), signal)
    const { width, height } = imageSizeOf(request.size)
    return {
      images: urls.map((url, index) => ({ index, url, width, height, prompt: request.prompt })),
      provider: this.id,
      model,
    }
  }

  async generateVideo(request: GenerateVideoRequest, signal: AbortSignal): Promise<GenerateVideoResult> {
    const { model } = this.requireCredentials()
    const duration = Math.min(MAX_VIDEO_DURATION, Math.max(MIN_VIDEO_DURATION, Math.round(request.durationSeconds)))
    const taskId = await this.submit(signal, model, {
      prompt: request.prompt,
      duration,
      resolution: request.resolution,
      aspect_ratio: request.aspectRatio,
    })
    const urls = await this.resolveDownloadUrls(await this.poll(signal, taskId), signal)
    return {
      videos: urls.map((url, index) => ({
        index,
        url,
        durationSeconds: duration,
        resolution: request.resolution,
        aspectRatio: request.aspectRatio,
        prompt: request.prompt,
      })),
      provider: this.id,
      model,
    }
  }

  /** Validate the api key and model, returning the capability id. */
  private requireCredentials(): { model: string } {
    const { apiKey, model } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 apiKeyEnv，如 KIE_API_KEY）`)
    }
    if (model === undefined || model === '') {
      throw new Error(`${this.id}: 未配置模型能力名（请在设置里配置 model，如 bytedance/seedance-2-5）`)
    }
    return { model }
  }

  /** Create a generation task and return its taskId. */
  private async submit(signal: AbortSignal, model: string, input: Record<string, unknown>): Promise<string> {
    const { baseURL, apiKey } = this.options
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    const response = await fetch(`${trimSlash(baseURL)}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${this.id} createTask 失败 ${response.status}${body ? `: ${body}` : ''}`)
    }
    const payload = (await response.json()) as { code?: number; msg?: string; data?: { taskId?: string } }
    if (payload.code !== 200) {
      throw new Error(`${this.id} createTask 返回错误 ${payload.code ?? '?'}: ${payload.msg ?? ''}`)
    }
    const taskId = payload.data?.taskId
    if (taskId === undefined || taskId === '') {
      throw new Error(`${this.id}: createTask 响应缺少 taskId`)
    }
    return taskId
  }

  /** Resolve every result URL into a direct, fetchable download URL via the
   *  common download-url endpoint. KIE result URLs are internal tempfile
   *  references that cannot be fetched directly (cross-domain/auth), so each
   *  must be converted — otherwise the attachment seam fails to download and
   *  the image never renders in the conversation. A conversion failure keeps
   *  the original URL so the call still degrades to text instead of throwing. */
  private async resolveDownloadUrls(urls: readonly string[], signal: AbortSignal): Promise<string[]> {
    return Promise.all(urls.map((url) => this.downloadUrl(url, signal)))
  }

  /** Convert one result URL into a temporary direct download link. */
  private async downloadUrl(url: string, signal: AbortSignal): Promise<string> {
    const { baseURL, apiKey } = this.options
    try {
      const response = await fetch(`${trimSlash(baseURL)}/api/v1/common/download-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url }),
        signal,
      })
      if (!response.ok) return url
      const payload = (await response.json()) as { code?: number; data?: string | { downloadUrl?: string } }
      if (payload.code !== 200) return url
      const data = payload.data
      if (typeof data === 'string' && data !== '') return data
      if (data !== undefined && typeof data === 'object' && typeof data.downloadUrl === 'string' && data.downloadUrl !== '') {
        return data.downloadUrl
      }
      return url
    } catch {
      return url
    }
  }

  /** Poll the task until success (returns resultUrls) or failure. */
  private async poll(signal: AbortSignal, taskId: string): Promise<string[]> {
    const { baseURL, apiKey } = this.options
    const headers = { Authorization: `Bearer ${apiKey}` }
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      signal.throwIfAborted()
      const response = await fetch(`${trimSlash(baseURL)}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers,
        signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`${this.id} recordInfo 轮询失败 ${response.status}${body ? `: ${body}` : ''}`)
      }
      const payload = (await response.json()) as {
        code?: number
        msg?: string
        data?: { state?: string; resultJson?: string; failCode?: string }
      }
      if (payload.code !== 200) {
        throw new Error(`${this.id} recordInfo 返回错误 ${payload.code ?? '?'}: ${payload.msg ?? ''}`)
      }
      const data = payload.data
      if (data?.state === 'fail') {
        throw new Error(`${this.id}: 任务失败${data.failCode !== undefined && data.failCode !== '' ? ` (${data.failCode})` : ''}`)
      }
      if (data?.state === 'success') {
        const result = JSON.parse(data.resultJson ?? '{}') as { resultUrls?: string[] }
        if (result.resultUrls !== undefined && result.resultUrls.length > 0) {
          return result.resultUrls
        }
        throw new Error(`${this.id}: 任务成功但 resultUrls 为空`)
      }
      await sleep(POLL_INTERVAL_MS, signal)
    }
    throw new Error(`${this.id}: 轮询超时（超过 ${MAX_POLLS} 次）`)
  }
}

function trimSlash(baseURL: string): string {
  return baseURL.replace(/\/+$/, '')
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

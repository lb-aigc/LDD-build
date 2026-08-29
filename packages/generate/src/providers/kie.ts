import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import type { ImageSize, ImageResolution } from '../config.ts'
import { resolutionAspectPixels } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 200
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 1000
const MIN_VIDEO_DURATION = 4
const MAX_VIDEO_DURATION = 30

/** KIE's file-upload API lives on a different origin than its task API. */
const DEFAULT_FILE_UPLOAD_BASE_URL = 'https://kieai.redpandaai.co'

/** Image size → aspect ratio fallback (used when the caller did not set an
 *  explicit aspectRatio; non-KIE providers only expose the three sizes). */
const SIZE_ASPECT_RATIOS: Readonly<Record<ImageSize, string>> = {
  '1024x1024': '1:1',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
}

/** KIE resolution caps per aspect ratio (from the GPT-image-2 docs): `1:1`
 *  cannot reach 4K (caps at 2K); `5:4` / `4:5` / `3:1` / `1:3` / `9:21` and
 *  `auto` cap at 1K; every other ratio reaches 4K. The requested resolution is
 *  clamped to the cap — "4K preferred, degrade only when the ratio forbids it." */
const MAX_RESOLUTION_FOR: Readonly<Record<string, ImageResolution>> = {
  auto: '1K',
  '1:1': '2K',
  '5:4': '1K',
  '4:5': '1K',
  '3:1': '1K',
  '1:3': '1K',
  '9:21': '1K',
}
const RESOLUTION_ORDER: Readonly<Record<ImageResolution, number>> = { '4K': 3, '2K': 2, '1K': 1 }

/** Highest resolution tier KIE supports for a given aspect ratio. */
export function kieMaxResolution(aspectRatio: string): ImageResolution {
  return MAX_RESOLUTION_FOR[aspectRatio] ?? '4K'
}

/** Clamp a requested tier to the ratio's cap — "4K preferred, degrade only
 *  when the ratio forbids it" (1:1 → 2K; 4:5 / 5:4 / 9:21 → 1K). */
export function kieClampResolution(requested: ImageResolution, aspectRatio: string): ImageResolution {
  const cap = kieMaxResolution(aspectRatio)
  return RESOLUTION_ORDER[requested] <= RESOLUTION_ORDER[cap] ? requested : cap
}

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
 * purely as result metadata, not as a wire parameter.
 *
 * Image-to-image: the i2i capability is a DIFFERENT model id (e.g.
 * `gpt-image-2-image-to-image`), configured via `imageToImageModel`. Its
 * `input` carries `input_urls` (public URLs, NOT data URIs), `aspect_ratio`,
 * and `resolution` per the KIE i2i protocol.
 */
export class KieProvider implements GenerationProvider {
  readonly id = 'kie'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    const { model } = this.requireCredentials()
    const references = request.inputImages ?? []
    const isImageToImage = references.length > 0
    const aspectRatio = this.resolveAspectRatio(request)
    const resolution = this.resolveResolution(request.resolution ?? '4K', aspectRatio)
    const taskId = isImageToImage
      ? await this.submitImageToImage(signal, references, request.prompt, aspectRatio, resolution)
      : await this.submit(signal, model, { prompt: request.prompt, aspect_ratio: aspectRatio, resolution })
    const urls = await this.resolveDownloadUrls(await this.poll(signal, taskId), signal)
    const { width, height } = resolutionAspectPixels(resolution, aspectRatio)
    return {
      images: urls.map((url, index) => ({ index, url, width, height, prompt: request.prompt })),
      provider: this.id,
      model: isImageToImage ? (this.options.imageToImageModel || model) : model,
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

  /** Submit an i2i task against the configured image-to-image capability. */
  private async submitImageToImage(
    signal: AbortSignal,
    references: readonly string[],
    prompt: string,
    aspectRatio: string,
    resolution: ImageResolution,
  ): Promise<string> {
    const i2iModel = this.options.imageToImageModel
    if (i2iModel === undefined || i2iModel === '') {
      throw new Error(`${this.id}: 图生图需要配置 imageToImageModel（如 gpt-image-2-image-to-image）`)
    }
    const inputUrls: string[] = []
    for (const reference of references) {
      inputUrls.push(await this.resolveToPublicUrl(reference, signal))
    }
    return await this.submit(signal, i2iModel, {
      prompt,
      input_urls: inputUrls,
      aspect_ratio: aspectRatio,
      resolution,
    })
  }

  /** The aspect ratio to send: the caller's explicit value, else the size
   *  fallback, else 1:1. */
  private resolveAspectRatio(request: GenerateImageRequest): string {
    return request.aspectRatio ?? SIZE_ASPECT_RATIOS[request.size] ?? '1:1'
  }

  /** Clamp the requested resolution to the ratio's cap (4K → 2K → 1K). */
  private resolveResolution(requested: ImageResolution, aspectRatio: string): ImageResolution {
    return kieClampResolution(requested, aspectRatio)
  }

  /** Resolve one reference image into a public URL KIE's i2i `input_urls` can
   *  consume. http(s) URLs pass through; local `data:` URIs are uploaded to
   *  KIE's file-upload API and replaced with the returned public URL. */
  private async resolveToPublicUrl(reference: string, signal: AbortSignal): Promise<string> {
    if (reference.startsWith('http://') || reference.startsWith('https://')) return reference
    if (reference.startsWith('data:')) return await this.uploadBase64(reference, signal)
    throw new Error(`${this.id}: 参考图必须是 http(s) URL 或 data URI（收到 ${reference.slice(0, 40)}…）`)
  }

  /** Upload a base64 image (data URI or raw base64) to KIE and return its
   *  public download URL. Files are temporary (auto-deleted in ~24h), which is
   *  enough for an immediate image-to-image call. */
  private async uploadBase64(dataUri: string, signal: AbortSignal): Promise<string> {
    const { apiKey } = this.options
    const uploadBaseURL = this.options.fileUploadBaseURL ?? DEFAULT_FILE_UPLOAD_BASE_URL
    const response = await fetchWithRetry(`${trimSlash(uploadBaseURL)}/api/file-base64-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ base64Data: dataUri, uploadPath: 'images/base64' }),
    }, signal)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${this.id} 图片上传失败 ${response.status}${body ? `: ${body}` : ''}`)
    }
    const payload = (await response.json()) as {
      code?: number
      msg?: string
      data?: { downloadUrl?: string; fileUrl?: string }
    }
    if (payload.code !== 200) {
      throw new Error(`${this.id} 图片上传返回错误 ${payload.code ?? '?'}: ${payload.msg ?? ''}`)
    }
    const url = payload.data?.downloadUrl ?? payload.data?.fileUrl
    if (url === undefined || url === '') {
      throw new Error(`${this.id}: 图片上传响应缺少 URL`)
    }
    return url
  }

  /** Create a generation task and return its taskId. */
  private async submit(signal: AbortSignal, model: string, input: Record<string, unknown>): Promise<string> {
    const { baseURL, apiKey } = this.options
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    const response = await fetchWithRetry(`${trimSlash(baseURL)}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input }),
    }, signal)
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
      const response = await fetchWithRetry(`${trimSlash(baseURL)}/api/v1/common/download-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url }),
      }, signal)
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
      const response = await fetchWithRetry(`${trimSlash(baseURL)}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers,
      }, signal)
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

/** Fetch with bounded exponential-backoff retry for transient server errors
 *  (5xx, 429, 408) and network failures. Client errors (4xx) are returned
 *  as-is (the caller surfaces them) and user aborts rethrow immediately —
 *  retrying either cannot help. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  attempts = RETRY_ATTEMPTS,
): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    signal.throwIfAborted()
    try {
      const response = await fetch(url, { ...init, signal })
      const retryable = response.status >= 500 || response.status === 429 || response.status === 408
      if (!retryable) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw error
      lastError = error
    }
    if (i < attempts - 1) await sleep(RETRY_BASE_MS * 2 ** i, signal)
  }
  throw lastError
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

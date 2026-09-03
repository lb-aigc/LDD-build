import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import type { ImageSize } from '../config.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

const POLL_INTERVAL_MS = 3000
// Poll ceiling: 200 × 3s = 10 min — a deliberate cap. BYOK tasks CAN queue
// up to 1 hour for a busy bound account, but the user prefers a fast, explicit
// timeout over waiting out the queue. On timeout we report that the task is
// still queued server-side (job_id kept for later lookup, not a failure).
const MAX_POLLS = 200
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 1000

/** image size → Midjourney `--ar` aspect-ratio flag. */
const SIZE_ASPECT_RATIOS: Readonly<Record<ImageSize, string>> = {
  '1024x1024': '1:1',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
}

/**
 * Legnext.ai adapter (https://legnext.ai) — an UNOFFICIAL Midjourney REST API.
 * One `x-api-key` reaches the Midjourney image models (V7 / V8.1 / V8.2) with
 * no Discord account. This is a DISTINCT protocol family (not openai-compatible,
 * not kie): the auth header is `x-api-key` (not `Bearer`), the prompt field is
 * `text` (not `prompt`), and the status endpoint needs no key.
 *
 * Protocol (from https://docs.legnext.ai):
 *   submit: POST {baseURL}/v1/diffusion   { text }          -> { job_id, status }
 *   poll:   GET  {baseURL}/v1/job/{job_id}                  -> { status, output, error }
 *   status in pending/staged/processing/retry -> completed | failed (terminal)
 *   output on completed: { image_url, image_urls[], seed }
 *
 * Midjourney version and style ride the `text` as `--v` / `--ar` / `--style`
 * flags (the service has no separate model/size fields). The `model` option is
 * repurposed as the default `--v` value (e.g. `8.2`); the `size` option maps
 * to `--ar`; the optional `style` maps to `--style`. A leading `v` on the model
 * is stripped: Legnext rejects `--v v8.2` and expects `--v 8.2`.
 *
 * Image-to-image is DELIBERATELY unsupported (it is a Midjourney relay, and MJ
 * i2i consistency is too poor to expose).
 */
export class LegnextProvider implements GenerationProvider {
  readonly id = 'legnext'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    if (request.inputImages !== undefined && request.inputImages.length > 0) {
      throw new Error(`${this.id}: 不支持图生图（Midjourney 图生图一致性差，已禁用）`)
    }
    const apiKey = this.requireKey()
    const text = buildText(request, this.options.model)
    const jobId = await this.submit(signal, apiKey, text)
    const urls = await this.poll(signal, jobId)
    const { width, height } = imageSizeOf(request.size)
    return {
      images: urls.map((url, index) => ({ index, url, width, height, prompt: request.prompt })),
      provider: this.id,
      model: this.options.model === '' ? 'midjourney' : this.options.model,
    }
  }

  async generateVideo(_request: GenerateVideoRequest, _signal: AbortSignal): Promise<GenerateVideoResult> {
    throw new Error(`${this.id}: 视频生成暂未接入（Legnext 视频能力后续单独接线）`)
  }

  async generateMusic(_request: import('../types.ts').GenerateMusicRequest, _signal: AbortSignal): Promise<import('../types.ts').GenerateMusicResult> {
    throw new Error(`${this.id}: 音乐生成暂未接入`)
  }

  private requireKey(): string {
    const { apiKey } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 apiKeyEnv，如 LEGNEXT_API_KEY）`)
    }
    return apiKey
  }

  /** Submit a diffusion task and return its job_id. */
  private async submit(signal: AbortSignal, apiKey: string, text: string): Promise<string> {
    const { baseURL } = this.options
    const response = await fetchWithRetry(`${trimSlash(baseURL)}/v1/diffusion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ text }),
    }, signal)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${this.id} diffusion 提交失败 ${response.status}${body ? `: ${body}` : ''}`)
    }
    const task = (await response.json()) as { job_id?: string }
    if (task.job_id === undefined || task.job_id === '') {
      throw new Error(`${this.id}: diffusion 响应缺少 job_id`)
    }
    return task.job_id
  }

  /** Poll the job until completed (returns image URLs) or failed. */
  private async poll(signal: AbortSignal, jobId: string): Promise<string[]> {
    const { baseURL } = this.options
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      signal.throwIfAborted()
      const response = await fetchWithRetry(`${trimSlash(baseURL)}/v1/job/${encodeURIComponent(jobId)}`, {}, signal)
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`${this.id} job 轮询失败 ${response.status}${body ? `: ${body}` : ''}`)
      }
      const task = (await response.json()) as {
        status?: string
        output?: { image_url?: string; image_urls?: string[] }
        error?: { message?: string; raw_message?: string }
      }
      if (task.status === 'failed') {
        const reason = task.error?.message ?? task.error?.raw_message ?? 'unknown'
        throw new Error(`${this.id}: 任务失败 (${reason})`)
      }
      if (task.status === 'completed') {
        const urls = task.output?.image_urls?.filter((url) => url !== undefined && url !== '') ?? []
        if (urls.length > 0) return urls
        const single = task.output?.image_url
        if (single !== undefined && single !== '') return [single]
        throw new Error(`${this.id}: 任务完成但未返回图片 URL`)
      }
      await sleep(POLL_INTERVAL_MS, signal)
    }
    throw new Error(`${this.id}: 任务超过 10 分钟未完成（已轮询 ${MAX_POLLS} 次）。任务仍在服务端排队/生成中，未失败。\n任务 ID：${jobId}\n可能原因：BYOK 模式下 Midjourney 账号繁忙，任务在排队等待。建议稍后在 Legnext 后台查看该任务状态，或稍后重试。`)
  }
}

/** Strip a leading `v`/`V` from a Midjourney version token so both `v8.2` and
 *  `8.2` emit `--v 8.2` (Legnext rejects the `v` prefix). */
function mjVersionToken(model: string): string {
  return model.replace(/^[vV]\s*/, '')
}

export function buildText(request: GenerateImageRequest, model: string): string {
  const parts = [request.prompt]
  if (model !== '' && model !== 'midjourney') {
    parts.push(`--v ${mjVersionToken(model)}`)
  }
  parts.push(`--ar ${SIZE_ASPECT_RATIOS[request.size] ?? '1:1'}`)
  if (request.style !== undefined && request.style !== '') {
    parts.push(`--style ${request.style}`)
  }
  return parts.join(' ')
}

function trimSlash(baseURL: string): string {
  return baseURL.replace(/\/+$/, '')
}

/** Fetch with bounded exponential-backoff retry for transient server errors
 *  (429 = account concurrency/queue, 5xx, 408) and network failures. Client
 *  errors (400/401/402/403) return as-is; user aborts rethrow immediately.
 *  Legnext docs prescribe retrying exactly these classes. */
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

import type { GeneratedMusic, GenerateMusicRequest, GenerateMusicResult } from '../types.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 200
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 1000

/**
 * Suno music adapter (KIE's Suno API, https://kie.ai/suno-api). Suno is a
 * SEPARATE product line on the same KIE platform (api.kie.ai) but uses its OWN
 * endpoint protocol, distinct from the image/video `createTask` path:
 *
 *   submit: POST {baseURL}/api/v1/generate
 *           { prompt, customMode, instrumental, model, style?, title?,
 *             callBackUrl: "playground" }  // required non-empty; KIE's own
 *                                          // playground sends this literal
 *           -> { code: 200, msg, data: { taskId } }
 *   poll:   GET {baseURL}/api/v1/generate/record-info?taskId=xxx
 *           -> { code: 200, data: { status, response: { sunoData: [...] } } }
 *           status in SUCCESS / FIRST_SUCCESS / TEXT_SUCCESS / PENDING /
 *           CREATE_TASK_FAILED / GENERATE_AUDIO_FAILED / CALLBACK_EXCEPTION /
 *           SENSITIVE_WORD_ERROR
 *           sunoData[i] = { audio_url, image_url, prompt, model_name, title,
 *                           createTime, duration, tags }
 *
 * `model` is a Suno version id (V5_5 / V5 / V4_5PLUS / V4_5 / V4_5ALL / V4).
 *
 * Custom mode (`customMode: true`) requires `style` + `title` (+ `prompt` as
 * exact lyrics when `instrumental: false`). Non-custom mode (`customMode:
 * false`) needs only `prompt`.
 */
export class SunoProvider implements GenerationProvider {
  readonly id = 'suno'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(_request: import('../types.ts').GenerateImageRequest, _signal: AbortSignal): Promise<import('../types.ts').GenerateImageResult> {
    throw new Error(`${this.id}: 音乐模型不支持文生图`)
  }

  async generateVideo(_request: import('../types.ts').GenerateVideoRequest, _signal: AbortSignal): Promise<import('../types.ts').GenerateVideoResult> {
    throw new Error(`${this.id}: 音乐模型不支持生视频`)
  }

  async generateMusic(request: GenerateMusicRequest, signal: AbortSignal): Promise<GenerateMusicResult> {
    const { apiKey, model } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 apiKeyEnv，如 KIE_API_KEY）`)
    }
    if (model === undefined || model === '') {
      throw new Error(`${this.id}: 未配置 Suno 模型版本（请在设置里配置 model，如 V5_5）`)
    }
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      customMode: request.customMode,
      instrumental: request.instrumental,
      model,
      // KIE's Suno endpoints reject requests without a non-empty callBackUrl
      // (HTTP 422 "Please enter callBackUrl"). Their own playground always
      // sends the literal "playground" (not a real URL) — a sentinel the
      // server accepts and treats as "no async callback, poll record-info".
      callBackUrl: 'playground',
    }
    if (request.customMode) {
      if (request.style !== undefined && request.style !== '') body.style = request.style
      if (request.title !== undefined && request.title !== '') body.title = request.title
    }
    const taskId = await this.submit(signal, body)
    const tracks = await this.poll(signal, taskId)
    const music: GeneratedMusic[] = tracks.map((track, index) => ({
      index,
      url: track.audio_url ?? '',
      coverUrl: track.image_url ?? '',
      title: track.title ?? '',
      durationSeconds: typeof track.duration === 'number' ? track.duration : 0,
      tags: track.tags ?? '',
      modelName: track.model_name ?? model,
      prompt: track.prompt ?? request.prompt,
    }))
    return { music, provider: this.id, model }
  }

  /** Submit a music task and return its taskId. */
  private async submit(signal: AbortSignal, body: Record<string, unknown>): Promise<string> {
    const { baseURL, apiKey } = this.options
    const response = await fetchWithRetry(`${trimSlash(baseURL)}/api/v1/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }, signal)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${this.id} generate 失败 ${response.status}${text ? `: ${text}` : ''}`)
    }
    const payload = (await response.json()) as { code?: number; msg?: string; data?: { taskId?: string } }
    if (payload.code !== 200) {
      throw new Error(`${this.id} generate 返回错误 ${payload.code ?? '?'}: ${payload.msg ?? ''}`)
    }
    const taskId = payload.data?.taskId
    if (taskId === undefined || taskId === '') {
      throw new Error(`${this.id}: generate 响应缺少 taskId`)
    }
    return taskId
  }

  /** Poll until the task yields at least one completed track, or fails. */
  private async poll(
    signal: AbortSignal,
    taskId: string,
  ): Promise<Array<{
    audio_url: string
    image_url: string | undefined
    prompt: string | undefined
    model_name: string | undefined
    title: string | undefined
    duration: number | undefined
    tags: string | undefined
  }>> {
    const { baseURL, apiKey } = this.options
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      signal.throwIfAborted()
      const response = await fetchWithRetry(
        `${trimSlash(baseURL)}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        signal,
      )
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`${this.id} record-info 轮询失败 ${response.status}${text ? `: ${text}` : ''}`)
      }
      const payload = (await response.json()) as {
        code?: number
        msg?: string
        data?: { status?: string; response?: { sunoData?: unknown[] }; errorMessage?: string }
      }
      if (payload.code !== 200) {
        throw new Error(`${this.id} record-info 返回错误 ${payload.code ?? '?'}: ${payload.msg ?? ''}`)
      }
      const data = payload.data
      const status = data?.status ?? ''
      if (status.endsWith('_FAILED') || status === 'CREATE_TASK_FAILED' || status === 'SENSITIVE_WORD_ERROR') {
        throw new Error(`${this.id}: 任务失败 (${status})${data?.errorMessage ? `: ${data.errorMessage}` : ''}`)
      }
      if (status === 'SUCCESS' || status === 'FIRST_SUCCESS') {
        const sunoData = (data?.response?.sunoData ?? []) as Array<Record<string, unknown>>
        const completed = sunoData.filter((track) => typeof track.audio_url === 'string' && track.audio_url !== '')
          .map((track) => ({
            audio_url: track.audio_url as string,
            image_url: typeof track.image_url === 'string' ? track.image_url as string : undefined,
            prompt: typeof track.prompt === 'string' ? track.prompt as string : undefined,
            model_name: typeof track.model_name === 'string' ? track.model_name as string : undefined,
            title: typeof track.title === 'string' ? track.title as string : undefined,
            duration: typeof track.duration === 'number' ? track.duration as number : undefined,
            tags: typeof track.tags === 'string' ? track.tags as string : undefined,
          }))
        if (completed.length > 0) return completed
        throw new Error(`${this.id}: 任务完成但音频列表为空`)
      }
      await sleep(POLL_INTERVAL_MS, signal)
    }
    throw new Error(`${this.id}: 轮询超时（超过 ${MAX_POLLS} 次）`)
  }
}

/** Fetch with bounded exponential-backoff retry for transient server errors
 *  (5xx, 429, 408) and network failures. Client errors (4xx) are returned
 *  as-is; user aborts rethrow immediately. */
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

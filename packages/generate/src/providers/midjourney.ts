import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 300

/**
 * Midjourney relay adapter. Midjourney has no official API, so it is reached
 * through third-party relays (GoAPI, Useapi, NextLeg, ...) whose task shape
 * varies. This adapter encodes the shared *async task* pattern — submit, then
 * poll a status endpoint until done — and must be calibrated to the specific
 * relay before use:
 *
 *   submit:  POST {baseURL}/imagine        → { jobId }
 *   poll:    GET  {baseURL}/status/{jobId} → { status: 'done'|'failed'|..., urls?: string[] }
 *
 * The exact paths/fields belong to the relay's docs, not Midjourney itself.
 *
 * Image-to-image is DELIBERATELY unsupported: Midjourney i2i consistency is too
 * poor to expose. A reference-image request fails with a clear message.
 */
export class MidjourneyProvider implements GenerationProvider {
  readonly id = 'midjourney'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    if (request.inputImages !== undefined && request.inputImages.length > 0) {
      throw new Error(`${this.id}: 不支持图生图（Midjourney 图生图一致性差，已禁用）`)
    }
    const { baseURL, model, apiKey } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 generate-image.apiKeyEnv）`)
    }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }

    const submit = await fetch(`${baseURL}/imagine`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: request.prompt, model: model || undefined }),
      signal,
    })
    if (!submit.ok) {
      const body = await submit.text().catch(() => '')
      throw new Error(`${this.id} imagine 提交失败 ${submit.status}${body ? `: ${body}` : ''}`)
    }
    const { jobId } = (await submit.json()) as { jobId?: string }
    if (jobId === undefined) throw new Error(`${this.id}: 提交响应缺少 jobId`)

    const { width, height } = imageSizeOf(request.size)
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      signal.throwIfAborted()
      const status = await fetch(`${baseURL}/status/${jobId}`, { headers, signal })
      if (!status.ok) {
        const body = await status.text().catch(() => '')
        throw new Error(`${this.id} 轮询失败 ${status.status}${body ? `: ${body}` : ''}`)
      }
      const task = (await status.json()) as { status?: string; urls?: string[] }
      if (task.status === 'failed') throw new Error(`${this.id}: 任务失败`)
      if (task.status === 'done' && task.urls !== undefined) {
        return {
          images: task.urls.map((url, index) => ({ index, url, width, height, prompt: request.prompt })),
          provider: this.id,
          model: model || 'midjourney',
        }
      }
      await sleep(POLL_INTERVAL_MS, signal)
    }
    throw new Error(`${this.id}: 轮询超时（超过 ${MAX_POLLS} 次）`)
  }

  async generateVideo(_request: GenerateVideoRequest, _signal: AbortSignal): Promise<GenerateVideoResult> {
    throw new Error(`${this.id}: 视频生成暂未接入`)
  }
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

import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

/**
 * OpenAI-compatible image/video host. One adapter serves gpt-image-2, OpenAI's
 * own endpoint, and every OpenAI-compatible aggregator (OpenRouter, SiliconFlow,
 * Together, ...). Image generation is synchronous; video generation is a later
 * integration (aggregator video endpoints vary between synchronous and task-
 * based), so it fails fast for now.
 */
export class OpenAICompatibleProvider implements GenerationProvider {
  readonly id = 'openai-compatible'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    this.requireApiKey()
    const { baseURL, model, apiKey } = this.options
    const response = await fetch(`${baseURL}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        n: request.count,
        size: request.size,
        ...(request.style === undefined ? {} : { style: request.style }),
      }),
      signal,
    })
    await assertOk(response, `${this.id} images/generations`)
    const payload = (await response.json()) as {
      data: Array<{ url?: string; b64_json?: string }>
    }
    const { width, height } = imageSizeOf(request.size)
    return {
      images: payload.data.map((item, index) => ({
        index,
        url: item.url ?? `data:image/png;base64,${item.b64_json ?? ''}`,
        width,
        height,
        prompt: request.prompt,
      })),
      provider: this.id,
      model,
    }
  }

  async generateVideo(_request: GenerateVideoRequest, _signal: AbortSignal): Promise<GenerateVideoResult> {
    throw new Error(`${this.id}: 视频生成暂未接入`)
  }

  private requireApiKey(): void {
    if (this.options.apiKey === undefined || this.options.apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 generate-image.apiKeyEnv）`)
    }
  }
}

/** Turn a non-2xx into a diagnostic error with the host's message. */
async function assertOk(response: Response, label: string): Promise<void> {
  if (response.ok) return
  const body = await response.text().catch(() => '')
  throw new Error(`${label} 请求失败 ${response.status}${body ? `: ${body}` : ''}`)
}

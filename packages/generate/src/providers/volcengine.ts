import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'

/**
 * Volcengine Ark image host (Seedream). Ark exposes an OpenAI-flavoured
 * `POST {baseURL}/images/generations` with `Authorization: Bearer {ARK key}` and
 * a `doubao-seedream-*` model id, but its size enum (`1K`/`2K`) and response
 * fields differ from OpenAI — hence its own adapter. Calibrate the model id and
 * size mapping against the Ark console before use.
 */
export class VolcengineProvider implements GenerationProvider {
  readonly id = 'volcengine'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    const { baseURL, model, apiKey } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 generate-image.apiKeyEnv）`)
    }
    if (model === undefined || model === '') {
      throw new Error(`${this.id}: 未配置模型（请在设置里配置 generate-image.model，如 doubao-seedream-*）`)
    }
    const response = await fetch(`${baseURL}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        n: request.count,
        size: request.size,
        response_format: 'url',
      }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${this.id} images/generations 请求失败 ${response.status}${body ? `: ${body}` : ''}`)
    }
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
}

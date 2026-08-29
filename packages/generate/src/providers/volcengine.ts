import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'
import { resolveImageBase64 } from './image-input.ts'

/**
 * Volcengine Ark image host (Seedream). Ark exposes an OpenAI-flavoured
 * `POST {baseURL}/images/generations` with `Authorization: Bearer <key>` and a
 * `doubao-seedream-*` model id, but its size enum (`1K`/`2K`) and response
 * fields differ from OpenAI — hence its own adapter. Calibrate the model id and
 * size mapping against the Ark console before use.
 *
 * Image-to-image: Ark serves i2i through a distinct edit model (SeedEdit), so
 * `imageToImageModel` must be configured (falls back to `model` otherwise).
 * The reference image is sent as a base64 `data:` URI in the `image` field.
 */
export class VolcengineProvider implements GenerationProvider {
  readonly id = 'volcengine'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    const { baseURL, apiKey } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 generate-image.apiKeyEnv）`)
    }
    const references = request.inputImages ?? []
    const model = references.length > 0
      ? (this.options.imageToImageModel || this.options.model)
      : this.options.model
    if (model === undefined || model === '') {
      throw new Error(`${this.id}: 未配置模型（请在设置里配置 generate-image.model，如 doubao-seedream-*）`)
    }
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: request.count,
      size: request.size,
      response_format: 'url',
    }
    if (references.length > 0) {
      const first = references[0]!
      const { base64, mediaType } = await resolveImageBase64(first, signal)
      body.image = `data:${mediaType};base64,${base64}`
    }
    const response = await fetch(`${baseURL}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${this.id} images/generations 请求失败 ${response.status}${text ? `: ${text}` : ''}`)
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

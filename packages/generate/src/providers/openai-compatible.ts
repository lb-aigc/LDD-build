import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'
import { resolveImageBytes } from './image-input.ts'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * OpenAI-compatible image/video host. One adapter serves gpt-image-2, OpenAI's
 * own endpoint, and every OpenAI-compatible aggregator (OpenRouter, SiliconFlow,
 * Together, ...). Image generation is synchronous; video generation is a later
 * integration (aggregator video endpoints vary between synchronous and task-
 * based), so it fails fast for now.
 *
 * Image-to-image: `POST /images/edits` (multipart/form-data), the classic
 * OpenAI i2i endpoint. Reference images (URL or data URI) are downloaded and
 * attached as `image` parts. Calibrate against the host's docs — some
 * aggregators only accept one reference image or a JSON `input` array instead.
 */
export class OpenAICompatibleProvider implements GenerationProvider {
  readonly id = 'openai-compatible'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    this.requireApiKey()
    const references = request.inputImages ?? []
    if (references.length > 0) {
      return await this.generateImageToImage(request, references, signal)
    }
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

  private async generateImageToImage(
    request: GenerateImageRequest,
    references: readonly string[],
    signal: AbortSignal,
  ): Promise<GenerateImageResult> {
    const { baseURL, apiKey } = this.options
    const model = this.options.imageToImageModel || this.options.model
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', request.prompt)
    form.append('n', String(request.count))
    form.append('size', request.size)
    if (request.style !== undefined && request.style !== '') form.append('style', request.style)
    for (const [index, reference] of references.entries()) {
      const { data, mediaType } = await resolveImageBytes(reference, signal)
      const extension = EXTENSIONS[mediaType] ?? 'png'
      form.append('image', new Blob([data as unknown as BlobPart], { type: mediaType }), `reference-${index}.${extension}`)
    }
    const response = await fetch(`${baseURL}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    })
    await assertOk(response, `${this.id} images/edits`)
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

  async generateMusic(_request: import('../types.ts').GenerateMusicRequest, _signal: AbortSignal): Promise<import('../types.ts').GenerateMusicResult> {
    throw new Error(`${this.id}: 音乐生成暂未接入`)
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

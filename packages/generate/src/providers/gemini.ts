import type { GenerateImageRequest, GenerateImageResult, GenerateVideoRequest, GenerateVideoResult } from '../types.ts'
import { imageSizeOf } from '../provider.ts'
import type { GenerationProvider, ProviderOptions } from '../provider.ts'
import { resolveImageBase64 } from './image-input.ts'

/**
 * Google Gemini image host (Nano Banana = Gemini 2.5 Flash Image). Uses the
 * `generateContent` shape with `responseModalities: ['IMAGE']` — NOT the OpenAI
 * `images/generations` shape, so it needs its own adapter.
 *
 * Image-to-image: reference images become `inlineData` parts preceding the text
 * prompt in the same `contents[0].parts` array.
 *
 * Endpoint/field names track the current Gemini REST API; calibrate against the
 * official docs before pointing at a real key.
 */
export class GeminiImageProvider implements GenerationProvider {
  readonly id = 'gemini'

  private readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    const { baseURL, model, apiKey } = this.options
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${this.id}: 未配置 API key（请在设置里配置 generate-image.apiKeyEnv）`)
    }
    const references = request.inputImages ?? []
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    for (const reference of references) {
      const { base64, mediaType } = await resolveImageBase64(reference, signal)
      parts.push({ inlineData: { mimeType: mediaType, data: base64 } })
    }
    parts.push({ text: request.prompt })
    const response = await fetch(`${baseURL}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${this.id} generateContent 请求失败 ${response.status}${body ? `: ${body}` : ''}`)
    }
    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
      }>
    }
    const { width, height } = imageSizeOf(request.size)
    const images = (payload.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => part.inlineData?.data !== undefined)
      .map((part, index) => ({
        index,
        url: `data:${part.inlineData!.mimeType ?? 'image/png'};base64,${part.inlineData!.data}`,
        width,
        height,
        prompt: request.prompt,
      }))
    if (images.length === 0) {
      throw new Error(`${this.id}: 响应中未找到图片（candidates 为空）`)
    }
    return { images, provider: this.id, model }
  }

  async generateVideo(_request: GenerateVideoRequest, _signal: AbortSignal): Promise<GenerateVideoResult> {
    throw new Error(`${this.id}: 视频生成暂未接入`)
  }

  async generateMusic(_request: import('../types.ts').GenerateMusicRequest, _signal: AbortSignal): Promise<import('../types.ts').GenerateMusicResult> {
    throw new Error(`${this.id}: 音乐生成暂未接入`)
  }
}

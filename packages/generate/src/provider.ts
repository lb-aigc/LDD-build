import type {
  GeneratedImage,
  GeneratedMusic,
  GeneratedVideo,
  GenerateImageRequest,
  GenerateImageResult,
  GenerateMusicRequest,
  GenerateMusicResult,
  GenerateVideoRequest,
  GenerateVideoResult,
} from './types.ts'

/**
 * The generation capability seam. A plugin binds one provider; tool bodies
 * resolve it per call and forward the caller signal so cancellation and the
 * per-call timeout reach the implementation.
 *
 * The shipped {@link MockGenerationProvider} proves the routing link — user
 * request → LLM decision → tool dispatch → provider result → LLM follow-up —
 * without a live image/video/audio API. Swap in a real implementation (e.g. a
 * Seedance video provider or a Flux image provider) without touching the
 * tools, skill, or plugin-tree wiring.
 */
export interface GenerationProvider {
  /** Stable provider id, echoed into every result for the model. */
  readonly id: string
  generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult>
  generateVideo(request: GenerateVideoRequest, signal: AbortSignal): Promise<GenerateVideoResult>
  generateMusic(request: GenerateMusicRequest, signal: AbortSignal): Promise<GenerateMusicResult>
}

/** Resolved inputs every wire-protocol adapter needs (see `src/providers/`). */
export interface ProviderOptions {
  /** Endpoint root the adapter POSTs to (preset default or user override). */
  readonly baseURL: string
  /** Model id sent to the host. */
  readonly model: string
  /** Resolved API key; `undefined` when unconfigured — adapters fail fast on it. */
  readonly apiKey: string | undefined
  /**
   * Model id used for image-to-image generation. Blank means the adapter falls
   * back to {@link model} (correct for GPT Image / Gemini, whose text and i2i
   * models are the same). Providers with a distinct i2i capability (KIE,
   * Seedream/SeedEdit) resolve it here.
   */
  readonly imageToImageModel: string
  /**
   * KIE-only: base URL of the file-upload endpoint used to turn a local
   * `data:` URI into a public URL (`POST /api/file-base64-upload`). Defaults to
   * `https://kieai.redpandaai.co` — KIE serves its upload API from a different
   * origin than its task API (`api.kie.ai`), with the same Bearer key.
   */
  readonly fileUploadBaseURL?: string
}

export function imageSizeOf(size: string): { width: number; height: number } {
  const [width, height] = size.split('x').map((part) => Number.parseInt(part, 10))
  return { width: width ?? 1024, height: height ?? 1024 }
}

/** Map an aspect ratio to the nearest OpenAI-style pixel size (non-KIE
 *  providers only expose 1:1 / 16:9 / 9:16). */
export function aspectRatioToImageSize(aspectRatio: string): string {
  const parts = aspectRatio.split(':').map((part) => Number.parseInt(part, 10))
  const w = parts[0] ?? 1
  const h = parts[1] ?? 1
  if (w === h) return '1024x1024'
  return w > h ? '1792x1024' : '1024x1792'
}

/** Nominal pixel geometry for a resolution tier + aspect ratio. KIE scales the
 *  LONG edge: 4K ≈ 3840 (UHD, verified — a 4K 16:9 result downloads at
 *  3840×2160), 2K ≈ 2048, 1K ≈ 1024. Used as result metadata only — KIE does
 *  not echo exact pixels back, so this is the honest nominal size, not the
 *  former "short edge 4096" that overstated 4K as 7282×4096. */
export function resolutionAspectPixels(resolution: string, aspectRatio: string): { width: number; height: number } {
  const longEdge = resolution === '4K' ? 3840 : resolution === '2K' ? 2048 : 1024
  const parts = aspectRatio.split(':').map((part) => Number.parseInt(part, 10))
  const w = parts[0] ?? 0
  const h = parts[1] ?? 0
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: longEdge, height: longEdge }
  return w >= h
    ? { width: longEdge, height: Math.round((longEdge * h) / w) }
    : { width: Math.round((longEdge * w) / h), height: longEdge }
}

/**
 * Placeholder provider. It returns self-describing results so the agent loop
 * stays end-to-end functional — the LLM sees a successful generation and can
 * summarize, refine, or continue — while no external model is called.
 */
export class MockGenerationProvider implements GenerationProvider {
  readonly id = 'mock'

  async generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult> {
    signal.throwIfAborted()
    const { width, height } = imageSizeOf(request.size)
    const images: GeneratedImage[] = []
    for (let index = 0; index < request.count; index++) {
      const i2i = request.inputImages !== undefined && request.inputImages.length > 0
        ? `&i2i=${request.inputImages.length}`
        : ''
      images.push({
        index,
        url: `mock-image://${index}?prompt=${encodeURIComponent(request.prompt)}&size=${request.size}${i2i}`,
        width,
        height,
        prompt: request.prompt,
      })
    }
    return { images, provider: 'mock', model: 'mock-image' }
  }

  async generateVideo(request: GenerateVideoRequest, signal: AbortSignal): Promise<GenerateVideoResult> {
    signal.throwIfAborted()
    const videos: GeneratedVideo[] = [{
      index: 0,
      url: `mock-video://0?prompt=${encodeURIComponent(request.prompt)}&duration=${request.durationSeconds}`,
      durationSeconds: request.durationSeconds,
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      prompt: request.prompt,
    }]
    return { videos, provider: 'mock', model: 'mock-video' }
  }

  async generateMusic(request: GenerateMusicRequest, signal: AbortSignal): Promise<GenerateMusicResult> {
    signal.throwIfAborted()
    const music: GeneratedMusic[] = [{
      index: 0,
      url: `mock-music://0?prompt=${encodeURIComponent(request.prompt)}`,
      coverUrl: '',
      title: request.title ?? 'Mock Track',
      durationSeconds: 120,
      tags: 'mock, placeholder',
      modelName: 'mock-music',
      prompt: request.prompt,
    }]
    return { music, provider: 'mock', model: 'mock-music' }
  }
}

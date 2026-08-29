import type {
  GeneratedImage,
  GeneratedVideo,
  GenerateImageRequest,
  GenerateImageResult,
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
 * without a live image/video API. Swap in a real implementation (e.g. a
 * Seedance video provider or a Flux image provider) without touching the
 * tools, skill, or plugin-tree wiring.
 */
export interface GenerationProvider {
  /** Stable provider id, echoed into every result for the model. */
  readonly id: string
  generateImage(request: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResult>
  generateVideo(request: GenerateVideoRequest, signal: AbortSignal): Promise<GenerateVideoResult>
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
}

export function imageSizeOf(size: string): { width: number; height: number } {
  const [width, height] = size.split('x').map((part) => Number.parseInt(part, 10))
  return { width: width ?? 1024, height: height ?? 1024 }
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
}

import type { ImageSize, ImageResolution, ImageAspectRatio, VideoAspectRatio, VideoResolution } from './config.ts'

/** One generated image's model-visible reference. */
export interface GeneratedImage {
  readonly index: number
  /** Stable locator — a real provider returns a URL or data URI; the mock returns a self-describing placeholder. */
  readonly url: string
  readonly width: number
  readonly height: number
  readonly prompt: string
}

/** One generated video's model-visible reference. */
export interface GeneratedVideo {
  readonly index: number
  readonly url: string
  readonly durationSeconds: number
  readonly resolution: VideoResolution
  readonly aspectRatio: VideoAspectRatio
  readonly prompt: string
}

/** Normalized request a provider receives for one image generation. */
export interface GenerateImageRequest {
  readonly prompt: string
  readonly count: number
  /** Pixel size (OpenAI-style). Non-KIE providers read this; KIE derives its
   *  geometry from {@link resolution} + {@link aspectRatio} instead. */
  readonly size: ImageSize
  readonly style?: string
  /**
   * KIE resolution tier — 4K preferred, degraded automatically by the provider
   *  when the chosen aspect ratio does not support it (1:1 → 2K; 4:5 / 5:4 /
   *  9:21 → 1K). Other providers ignore it.
   */
  readonly resolution?: ImageResolution
  /**
   * Aspect ratio (16:9, 9:16, 4:3, 3:4, 2:1, 1:2, 1:1, 4:5, 5:4, 21:9, 9:21).
   *  KIE sends this verbatim; other providers map it to their nearest size.
   */
  readonly aspectRatio?: ImageAspectRatio
  /**
   * Reference images for image-to-image generation, each an http(s) URL or a
   * `data:` URI. Empty/undefined means text-to-image. Providers that do not
   * support i2i reject a non-empty list (see the `imageToImage` capability on
   * the preset, e.g. Midjourney relays are excluded — their i2i consistency is
   * too poor to be worth exposing).
   */
  readonly inputImages?: readonly string[]
}

/** Normalized request a provider receives for one video generation. */
export interface GenerateVideoRequest {
  readonly prompt: string
  readonly durationSeconds: number
  readonly resolution: VideoResolution
  readonly aspectRatio: VideoAspectRatio
}

/** Normalized result a provider returns for image generation. */
export interface GenerateImageResult {
  readonly images: GeneratedImage[]
  readonly provider: string
  readonly model: string
}

/** Normalized result a provider returns for video generation. */
export interface GenerateVideoResult {
  readonly videos: GeneratedVideo[]
  readonly provider: string
  readonly model: string
}

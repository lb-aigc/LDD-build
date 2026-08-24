import type { ImageSize, VideoAspectRatio, VideoResolution } from './config.ts'

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
  readonly size: ImageSize
  readonly style?: string
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

/** Resolved generation config bound to one tool call. */
export interface ResolvedGenerationConfig {
  readonly provider: string
  readonly model: string
  readonly timeoutMs: number
}

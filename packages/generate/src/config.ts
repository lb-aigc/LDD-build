export const imageSizes = ['1024x1024', '1024x1792', '1792x1024'] as const
export type ImageSize = (typeof imageSizes)[number]

export const videoResolutions = ['720p', '1080p'] as const
export type VideoResolution = (typeof videoResolutions)[number]

export const videoAspectRatios = ['16:9', '9:16', '1:1'] as const
export type VideoAspectRatio = (typeof videoAspectRatios)[number]

export const maxImagesPerRequest = 4
export const maxVideoDurationSeconds = 30

/** Static plugin config resolved from cordis.patch.yml. */
export interface GenerationConfig {
  readonly provider: string
  readonly model: string
  readonly timeoutMs: number
}

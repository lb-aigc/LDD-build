export const imageSizes = ['1024x1024', '1024x1792', '1792x1024'] as const
export type ImageSize = (typeof imageSizes)[number]

/** KIE resolution tiers (highest first — the tool defaults to 4K and degrades). */
export const imageResolutions = ['4K', '2K', '1K'] as const
export type ImageResolution = (typeof imageResolutions)[number]

/** Aspect ratios exposed on the generation tools. KIE's GPT-image-2 family
 *  supports these ratios; 1:1 caps at 2K and 4:5 / 5:4 / 9:21 cap at 1K (the
 *  provider degrades automatically). */
export const imageAspectRatios = [
  '16:9', '9:16', '4:3', '3:4', '2:1', '1:2', '1:1', '4:5', '5:4', '21:9', '9:21',
] as const
export type ImageAspectRatio = (typeof imageAspectRatios)[number]

export const videoResolutions = ['720p', '1080p'] as const
export type VideoResolution = (typeof videoResolutions)[number]

export const videoAspectRatios = ['16:9', '9:16', '1:1'] as const
export type VideoAspectRatio = (typeof videoAspectRatios)[number]

/** Suno music model versions (capability ids, not display names). */
export const sunoModels = ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4_5ALL', 'V4'] as const
export type SunoModel = (typeof sunoModels)[number]

export const maxImagesPerRequest = 4
export const maxVideoDurationSeconds = 30
export const maxMusicTracksPerRequest = 4

/** Static plugin config resolved from cordis.patch.yml (technical params only). */
export interface GenerationConfig {
  readonly timeoutMs: number
}

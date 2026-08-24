import z from '@deepseek-ai/schemastery'

/**
 * Settings namespaces for the image- and video-generation halves. Kept
 * separate so the two capabilities configure independently: a user may route
 * images to a local model while videos go to a hosted provider.
 *
 * The namespace strings are spelled here rather than imported from
 * `@deepseek-ai/dsh-settings` so this plugin adds no host dependency edge: the
 * settings service is provided by the Harness plugin tree at runtime, and the
 * strings plus the type shim below are all the plugin needs to register. This
 * keeps the LDD lockfile free of a `@deepseek-ai/dsh-settings` resolution that
 * would otherwise force a re-resolution of the electron-builder git dependency.
 */
export const IMAGE_SETTINGS_NS = 'generate-image'
export const VIDEO_SETTINGS_NS = 'generate-video'

/** User-editable image-generation configuration. */
export interface ImageGenerationSettings {
  /** Provider id registered in the plugin's provider table (e.g. `mock`, later `seedream`). */
  provider?: string
  /** Model name the provider should run. */
  model?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Credential reference naming the API key the provider resolves. */
  apiKeyEnv?: string
}

/** User-editable video-generation configuration. */
export interface VideoGenerationSettings {
  provider?: string
  model?: string
  baseURL?: string
  apiKeyEnv?: string
}

export const ImageGenerationSettingsSchema: z<ImageGenerationSettings> = z.object({
  provider: z.string(),
  model: z.string(),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
})

export const VideoGenerationSettingsSchema: z<VideoGenerationSettings> = z.object({
  provider: z.string(),
  model: z.string(),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
})

/** Provider id used when settings carry none (headless boot or unconfigured). */
export const DEFAULT_PROVIDER = 'mock'
export const DEFAULT_IMAGE_MODEL = 'mock-image'
export const DEFAULT_VIDEO_MODEL = 'mock-video'

/**
 * Minimal type surface of the user-settings service this plugin consumes. It
 * mirrors the shapes of `@deepseek-ai/dsh-settings` (`SettingsScope` /
 * `SettingsProvider.register`) without importing that package, so the plugin
 * compiles against the Harness's runtime service while the lockfile stays
 * untouched. Upgrade to the real import when the build environment can run a
 * full resolution.
 */
export interface GenerationSettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
}

export interface GenerationSettingsProvider {
  register<T>(
    ns: string,
    schema: z<T>,
    options?: { readonly base?: Partial<T> },
  ): GenerationSettingsScope<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settings: GenerationSettingsProvider
  }
}

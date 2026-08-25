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

/**
 * One configured generation model. `provider` is the preset id (or `custom`)
 * and doubles as the ROUTING KEY: the agent picks a model by naming its
 * `provider` in the `provider` tool argument, and `default` references it.
 */
export interface GenerationModelEntry {
  /** Provider preset id (mock/gpt-image/nano-banana/midjourney/seedream) or `custom`. */
  provider: string
  /** Wire protocol, used only when `provider === 'custom'`. */
  protocol?: string
  /** Model name the provider should run; blank inherits the preset default. */
  model?: string
  /** Provider endpoint; blank inherits the preset default. */
  baseURL?: string
  /** Credential reference naming the API key the provider resolves. */
  apiKeyEnv?: string
}

/**
 * User-editable generation configuration: an ordered model list plus a default
 * routing key. The legacy flat fields (pre-multi-model) are retained so an
 * existing settings.yaml upgrades in place instead of erroring — `sync()`
 * promotes them to a single-entry list when `models` is absent.
 */
export interface GenerationSettings {
  /** Routing key (one model's `provider`) of the default model. */
  default?: string
  /** Configured models, in preference order. */
  models?: GenerationModelEntry[]
  /** @deprecated legacy flat field, auto-upgraded when `models` is empty. */
  provider?: string
  protocol?: string
  model?: string
  baseURL?: string
  apiKeyEnv?: string
}

export type ImageGenerationSettings = GenerationSettings
export type VideoGenerationSettings = GenerationSettings

const modelEntrySchema = z.object({
  provider: z.string(),
  protocol: z.string(),
  model: z.string(),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
})

const generationSettingsSchema = z.object({
  default: z.string(),
  models: z.array(modelEntrySchema),
  provider: z.string(),
  protocol: z.string(),
  model: z.string(),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
})

export const ImageGenerationSettingsSchema: z<ImageGenerationSettings> = generationSettingsSchema
export const VideoGenerationSettingsSchema: z<VideoGenerationSettings> = generationSettingsSchema

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

import z from '@deepseek-ai/schemastery'

/**
 * Generation settings schema. 0.2.0 derives the settings namespace from the
 * plugin entry id (`ldd-generate`, see cordis.patch.yml) — there is no manual
 * `settings.register(ns, schema)` call (removed in 0.2.0). The three
 * generation halves are volatile Config fields (`image`/`video`/`music`), so
 * the browser edits them through `remote.settings` path ops and the Host reads
 * them via `config.image.get()` + `loader/volatile-update`.
 */

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
  /**
   * Model id used for image-to-image generation. When unset, providers whose
   * text and image-to-image models are the same (GPT Image, Gemini) reuse
   * `model`; providers with a distinct i2i capability (KIE, Seedream/SeedEdit)
   * need it configured to route i2i requests correctly.
   */
  imageToImageModel?: string
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
export type MusicGenerationSettings = GenerationSettings

const modelEntrySchema = z.object({
  provider: z.string().default(''),
  protocol: z.string().default(''),
  model: z.string().default(''),
  baseURL: z.string().default(''),
  apiKeyEnv: z.string().default(''),
  imageToImageModel: z.string().default(''),
})

const generationSettingsSchema = z.object({
  default: z.string().default(''),
  models: z.array(modelEntrySchema).default([]),
  provider: z.string().default(''),
  protocol: z.string().default(''),
  model: z.string().default(''),
  baseURL: z.string().default(''),
  apiKeyEnv: z.string().default(''),
})

export const ImageGenerationSettingsSchema: z<ImageGenerationSettings> = generationSettingsSchema
export const VideoGenerationSettingsSchema: z<VideoGenerationSettings> = generationSettingsSchema
export const MusicGenerationSettingsSchema: z<MusicGenerationSettings> = generationSettingsSchema

/** Provider id used when settings carry none (headless boot or unconfigured). */
export const DEFAULT_PROVIDER = 'mock'
export const DEFAULT_IMAGE_MODEL = 'mock-image'
export const DEFAULT_VIDEO_MODEL = 'mock-video'

/**
 * Settings namespace: 0.2.0 derives the settings namespace from the plugin
 * entry id (`ldd-generate`, see cordis.patch.yml), NOT from a manual
 * `settings.register(ns, schema)` call (that API was removed in 0.2.0). The
 * three generation halves live as volatile Config fields (`image`/`video`/
 * `music`) so the browser edits them through `remote.settings` path ops.
 */
export const GENERATE_SETTINGS_NS = 'ldd-generate'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 0.2.0 settings presentation policy (structural: no dsh-settings import). */
    settings: {
      configure(presentation: { auto?: boolean }, owner?: unknown): () => void
    }
    credentials: import('./credentials.ts').CredentialsResolveLike
    /**
     * Structural face of @deepseek-ai/dsh-commands (kept local so this plugin
     * adds no dsh-commands import): enough of the registry to register the
     * composer's `/generate-model` slash command. Optional — headless hosts
     * compose no command registry.
     */
    commands?: {
      register(definition: {
        name: string
        description: string
        input?: { hint: string }
        recordInput?: boolean
        handler: (invocation: { agent: { id: string }; rawInput: string }) =>
          { kind: 'success' | 'error'; text?: string }
      }): () => void
    }
  }
}

/**
 * Browser-half provider presets and routing helpers. The Host's `src/presets.ts`
 * owns the full preset table (protocol/defaults/strengths); the card only needs
 * the id + label for its dropdown, plus the shared routing-key rule so the
 * `default` it writes matches what the Host resolves. Keep the ids and labels
 * in sync with `src/presets.ts`.
 */

/** A suggested model/capability id for a provider's model field. */
export interface ModelSuggestion {
  /** The exact capability id to send (e.g. `nano-banana-pro`). */
  readonly id: string
  /** Human label shown in the dropdown (e.g. `Nano Banana Pro`). */
  readonly label: string
  /**
   * The distinct image-to-image capability id auto-routed for this model, so
   * the user never fills `imageToImageModel` by hand. Omitted when the model
   * reuses its own id for i2i (Nano Banana series) or has no i2i at all.
   */
  readonly i2iModel?: string
}

export interface ClientPreset {
  readonly id: string
  readonly label: string
  /** Suggested model/capability ids for this provider's model field. */
  readonly suggestedModels: readonly ModelSuggestion[]
  /**
   * Credential reference preset for this provider (e.g. `KIE_API_KEY`).
   * Auto-filled into `apiKeyEnv` when the provider is selected, so the user
   * only enters the API key value and picks a model — no manual reference.
   */
  readonly defaultApiKeyEnv?: string
}

/** Sentinel value: reveals the protocol/endpoint fields for a manual host. */
export const CUSTOM_PROVIDER_ID = 'custom'

/** Id used for the built-in placeholder model. */
export const DEFAULT_PROVIDER = 'mock'

export const IMAGE_PRESETS: readonly ClientPreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  {
    id: 'gpt-image',
    label: 'GPT Image',
    suggestedModels: [
      { id: 'gpt-image-2', label: 'GPT Image 2' },
      { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
    ],
    defaultApiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana（Gemini 2.5 Flash Image）',
    suggestedModels: [{ id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }],
    defaultApiKeyEnv: 'GEMINI_API_KEY',
  },
  { id: 'midjourney', label: 'Midjourney', suggestedModels: [] },
  { id: 'seedream', label: 'Seedream（火山方舟）', suggestedModels: [], defaultApiKeyEnv: 'ARK_API_KEY' },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    // 每个选项标清文生图 + 图生图；i2iModel 让图生图自动路由到对应 capability，
    // 用户无需手动填「图生图模型」。Nano Banana 系列同 id 支持图生图，故无 i2iModel。
    suggestedModels: [
      { id: 'gpt-image-2-text-to-image', label: 'GPT Image 2（文生图 + 图生图）', i2iModel: 'gpt-image-2-image-to-image' },
      { id: 'nano-banana-pro', label: 'Nano Banana Pro（文生图 + 图生图）' },
      { id: 'nano-banana-2', label: 'Nano Banana 2（文生图 + 图生图）' },
      { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite（文生图 + 图生图）' },
      { id: 'bytedance/seedream', label: 'Seedream 4.0（文生图）' },
      { id: 'seedream/5-pro-text-to-image', label: 'Seedream 5.0 Pro（文生图 + 图生图）', i2iModel: 'seedream/5-pro-image-to-image' },
      { id: 'seedream/5-lite-text-to-image', label: 'Seedream 5.0 Lite（文生图 + 图生图）', i2iModel: 'seedream/5-lite-image-to-image' },
      { id: 'flux-2/pro-text-to-image', label: 'Flux-2 Pro（文生图 + 图生图）', i2iModel: 'flux-2/pro-image-to-image' },
      { id: 'flux-2/flex-text-to-image', label: 'Flux-2（文生图 + 图生图）', i2iModel: 'flux-2/flex-image-to-image' },
      { id: 'z-image', label: 'Z-image（文生图）' },
      { id: 'grok-imagine/text-to-image', label: 'Grok Imagine（文生图 + 图生图）', i2iModel: 'grok-imagine/image-to-image' },
    ],
    defaultApiKeyEnv: 'KIE_API_KEY',
  },
  {
    id: 'legnext',
    label: 'Legnext（MJ 中转）',
    suggestedModels: [
      { id: '8.2', label: 'MJ V8.2' },
      { id: '8.1', label: 'MJ V8.1' },
      { id: '7', label: 'MJ V7' },
    ],
    defaultApiKeyEnv: 'LEGNEXT_API_KEY',
  },
]

export const VIDEO_PRESETS: readonly ClientPreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    suggestedModels: [{ id: 'bytedance/seedance-2-5', label: 'Seedance 2.5' }],
    defaultApiKeyEnv: 'KIE_API_KEY',
  },
]

/**
 * Stable routing key for one list entry, mirroring the Host's rule: the preset
 * id is the key; duplicate ids get a `#n` suffix. `default` stores this key.
 */
export function routeKeyOf(models: readonly { provider?: string }[], index: number): string {
  const provider = models[index]?.provider || DEFAULT_PROVIDER
  const prior = models
    .slice(0, index)
    .filter((m) => (m.provider || DEFAULT_PROVIDER) === provider).length
  return prior === 0 ? provider : `${provider}#${prior + 1}`
}

/** The credential reference to auto-fill when a provider preset is selected. */
export function defaultApiKeyEnvOf(preset: ClientPreset): string {
  return preset.defaultApiKeyEnv ?? ''
}

/** The auto-routed image-to-image capability id for a provider's model, or '' */
export function i2iModelOf(preset: ClientPreset, modelId: string): string {
  return preset.suggestedModels.find((s) => s.id === modelId)?.i2iModel ?? ''
}

/** The first suggested model for a provider, used to seed a fresh provider row. */
export function firstModelOf(preset: ClientPreset): string {
  return preset.suggestedModels[0]?.id ?? ''
}

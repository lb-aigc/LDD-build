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
}

export interface ClientPreset {
  readonly id: string
  readonly label: string
  /** Suggested model/capability ids for this provider's model field. */
  readonly suggestedModels: readonly ModelSuggestion[]
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
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana（Gemini 2.5 Flash Image）',
    suggestedModels: [{ id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }],
  },
  { id: 'midjourney', label: 'Midjourney', suggestedModels: [] },
  { id: 'seedream', label: 'Seedream（火山方舟）', suggestedModels: [] },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    suggestedModels: [
      // 文生图
      { id: 'gpt-image-2-text-to-image', label: 'GPT Image 2（文生图）' },
      { id: 'nano-banana-pro', label: 'Nano Banana Pro（文生图 + 图生图）' },
      { id: 'nano-banana-2', label: 'Nano Banana 2（文生图 + 图生图）' },
      { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite（文生图 + 图生图）' },
      { id: 'bytedance/seedream', label: 'Seedream 4.0（文生图）' },
      { id: 'seedream/5-pro-text-to-image', label: 'Seedream 5.0 Pro（文生图）' },
      { id: 'seedream/5-lite-text-to-image', label: 'Seedream 5.0 Lite（文生图）' },
      { id: 'flux-2/pro-text-to-image', label: 'Flux-2 Pro（文生图）' },
      { id: 'flux-2/flex-text-to-image', label: 'Flux-2（文生图）' },
      // 图生图 / 编辑
      { id: 'gpt-image-2-image-to-image', label: 'GPT Image 2（图生图）' },
      { id: 'google/nano-banana-edit', label: 'Nano Banana（编辑）' },
      { id: 'seedream/4.5-edit', label: 'Seedream 4.5（编辑）' },
      { id: 'seedream/5-pro-image-to-image', label: 'Seedream 5.0 Pro（图生图）' },
      { id: 'flux-2/pro-image-to-image', label: 'Flux-2 Pro（图生图）' },
      { id: 'flux-2/flex-image-to-image', label: 'Flux-2（图生图）' },
    ],
  },
  {
    id: 'legnext',
    label: 'Legnext（MJ 中转）',
    suggestedModels: [
      { id: '8.2', label: 'MJ V8.2' },
      { id: '8.1', label: 'MJ V8.1' },
      { id: '7', label: 'MJ V7' },
    ],
  },
]

export const VIDEO_PRESETS: readonly ClientPreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    suggestedModels: [{ id: 'bytedance/seedance-2-5', label: 'Seedance 2.5' }],
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

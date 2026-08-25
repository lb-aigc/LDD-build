/**
 * Browser-half provider presets and routing helpers. The Host's `src/presets.ts`
 * owns the full preset table (protocol/defaults/strengths); the card only needs
 * the id + label for its dropdown, plus the shared routing-key rule so the
 * `default` it writes matches what the Host resolves. Keep the ids and labels
 * in sync with `src/presets.ts`.
 */

export interface ClientPreset {
  readonly id: string
  readonly label: string
  /** Suggested model/capability ids for this provider's model field. */
  readonly suggestedModels: readonly string[]
}

/** Sentinel value: reveals the protocol/endpoint fields for a manual host. */
export const CUSTOM_PROVIDER_ID = 'custom'

/** Id used for the built-in placeholder model. */
export const DEFAULT_PROVIDER = 'mock'

export const IMAGE_PRESETS: readonly ClientPreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  { id: 'gpt-image', label: 'GPT Image', suggestedModels: ['gpt-image-2', 'gpt-image-1.5'] },
  { id: 'nano-banana', label: 'Nano Banana（Gemini 2.5 Flash Image）', suggestedModels: ['gemini-2.5-flash-image'] },
  { id: 'midjourney', label: 'Midjourney', suggestedModels: [] },
  { id: 'seedream', label: 'Seedream（火山方舟）', suggestedModels: [] },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    suggestedModels: [
      'bytedance/seedream',
      'google/nano-banana',
      'gpt-image-2-text-to-image',
      'seedream/4.5-edit',
      'google/nano-banana-edit',
      'gpt-image-2-image-to-image',
    ],
  },
  { id: 'legnext', label: 'Legnext（MJ 中转）', suggestedModels: ['v8.2', 'v8.1', 'v7'] },
]

export const VIDEO_PRESETS: readonly ClientPreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  { id: 'kie', label: 'KIE（聚合中转）', suggestedModels: ['bytedance/seedance-2-5'] },
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

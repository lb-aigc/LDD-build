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
  /**
   * True for an AGGREGATOR (KIE): one configured entry + one key reaches EVERY
   * suggested model, so the composer picker lists them all. False (default)
   * keeps one entry = one chosen model (a version selector like GPT Image 2
   * vs 1.5, or an MJ version). Mirrors the Host's `ProviderPreset.models`.
   */
  readonly aggregator?: boolean
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
    aggregator: true,
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

export const MUSIC_PRESETS: readonly ClientPreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  {
    id: 'suno',
    label: 'Suno（KIE 音乐）',
    // Suno 模型版本（代际，非并列能力）：下拉选一个版本，一键切换。
    suggestedModels: [
      { id: 'V5_5', label: 'V5.5（定制模型）' },
      { id: 'V5', label: 'V5（表现力强、更快）' },
      { id: 'V4_5PLUS', label: 'V4.5+（更丰富音质，最长 8 分钟）' },
      { id: 'V4_5', label: 'V4.5（更智能提示词）' },
      { id: 'V4_5ALL', label: 'V4.5 ALL' },
      { id: 'V4', label: 'V4' },
    ],
    defaultApiKeyEnv: 'KIE_API_KEY',
  },
]

/**
 * Stable routing key for one list entry, mirroring the Host's rule. An
 * AGGREGATOR entry (a preset with `suggestedModels`) keys as `provider:model`
 * (its chosen default capability); a non-aggregator keys as the preset id with
 * a `#n` suffix on duplicates. `default` stores this key, so it survives
 * add/remove/reorder of other rows. Byte-identical to the Host's rule.
 */
export function routeKeyOf(
  models: readonly { provider?: string; model?: string }[],
  index: number,
  presets: readonly ClientPreset[],
): string {
  const provider = models[index]?.provider || DEFAULT_PROVIDER
  const preset = presets.find((p) => p.id === provider)
  if (preset?.aggregator === true && provider !== CUSTOM_PROVIDER_ID) {
    const modelId = models[index]?.model || preset.suggestedModels[0]!.id
    return `${provider}:${modelId}`
  }
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

/**
 * Normalize a stored `default` key into the current routing-key form. The old
 * provider-level form (`kie`) maps to the entry's concrete model key
 * (`kie:gpt-image-2-text-to-image`) when the provider is an aggregator; an
 * already-concrete key or a non-aggregator provider key passes through.
 * Mirrors the Host's `resolveDefaultKey` so a stale `default` self-heals on
 * both sides.
 */
export function normalizeDefaultKey(
  rawDefault: string,
  entries: readonly { provider?: string; model?: string }[],
  presets: readonly ClientPreset[],
): string {
  if (rawDefault === '') return rawDefault
  // Already a concrete model key (contains ':') → trust it.
  if (rawDefault.includes(':')) return rawDefault
  const hit = entries.find((e) => (e.provider || DEFAULT_PROVIDER) === rawDefault)
  if (hit === undefined) return rawDefault
  const preset = presets.find((p) => p.id === (hit.provider || DEFAULT_PROVIDER))
  if (preset?.aggregator === true && hit.provider !== CUSTOM_PROVIDER_ID) {
    const modelId = hit.model || preset.suggestedModels[0]!.id
    return `${hit.provider}:${modelId}`
  }
  return rawDefault
}

/** One selectable generation model (routing key + human label + default flag). */
export interface PickerModel {
  readonly key: string
  readonly label: string
  readonly isDefault: boolean
}

/**
 * Resolve the generate-image settings value into the composer picker's list.
 * An AGGREGATOR entry (KIE) expands into every one of its capabilities, so a
 * single key lists all its models; non-aggregators stay one entry = one model.
 * Keys mirror the Host (`provider:modelId` for aggregators, `provider` /
 * `provider#n` otherwise), so a pick routes to the exact same model the tool
 * would. Kept dependency-light (only the preset table) so it is directly
 * testable under the strip-only verify harness.
 */
export function resolvePickerModels(value: {
  default?: string
  models?: Array<{ provider?: string; model?: string }>
} | undefined): { models: PickerModel[]; defaultKey: string } {
  const v = (value ?? {}) as Record<string, unknown>
  const rawModels = Array.isArray(v.models) && (v.models as unknown[]).length > 0
    ? v.models as Array<Record<string, unknown>>
    : [{ provider: typeof v.provider === 'string' ? v.provider : 'mock' }]
  const keyed = rawModels.map((entry) => ({
    provider: typeof entry.provider === 'string' && entry.provider !== '' ? entry.provider : 'mock',
    model: typeof entry.model === 'string' ? entry.model : '',
  }))
  const models: PickerModel[] = []
  const seenKeys = new Set<string>()
  rawModels.forEach((entry, index) => {
    const provider = keyed[index]?.provider ?? 'mock'
    const preset = IMAGE_PRESETS.find((p) => p.id === provider)
    if (preset?.aggregator === true && provider !== CUSTOM_PROVIDER_ID) {
      for (const suggestion of preset.suggestedModels) {
        const key = `${provider}:${suggestion.id}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        models.push({ key, label: suggestion.label, isDefault: false })
      }
    } else {
      const key = routeKeyOf(keyed, index, IMAGE_PRESETS)
      if (seenKeys.has(key)) return
      seenKeys.add(key)
      const modelId = keyed[index]?.model ?? ''
      const suggestion = preset?.suggestedModels.find((s) => s.id === modelId)
      const label = suggestion?.label ?? preset?.label ?? provider
      models.push({ key, label, isDefault: false })
    }
  })
  const defaultKey = normalizeDefaultKey(
    typeof v.default === 'string' ? v.default : '',
    keyed,
    IMAGE_PRESETS,
  ) || models[0]?.key || 'mock'
  return {
    models: models.map((m) => ({ ...m, isDefault: m.key === defaultKey })),
    defaultKey,
  }
}

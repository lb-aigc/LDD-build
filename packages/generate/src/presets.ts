/**
 * Provider presets and protocol classification.
 *
 * A preset is what the user picks in the settings card ("GPT Image", "Seedream",
 * ...). Each preset maps to a wire protocol that routes to a concrete adapter in
 * `providers/`. The `custom` preset is NOT in these tables — it is a sentinel
 * value: when `settings.provider === 'custom'`, the protocol, baseURL and model
 * are read verbatim from settings instead of inherited from a preset.
 *
 * Protocol adapters implement the HTTP shape of a family of hosts, so one
 * adapter serves many aggregators: `openai-compatible` drives gpt-image-2, any
 * OpenAI-compatible aggregator, and (for video) SiliconFlow-style hosts.
 */

export const PROVIDER_PROTOCOLS = [
  'mock',
  'openai-compatible',
  'gemini',
  'midjourney',
  'volcengine',
] as const

export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number]

/** A named, user-selectable provider preset shown in the settings card. */
export interface ProviderPreset {
  /** Stable preset id, stored verbatim in `settings.provider`. */
  readonly id: string
  /** Human label for the settings card dropdown. */
  readonly label: string
  /** Wire protocol the preset routes to. */
  readonly protocol: ProviderProtocol
  /** Default endpoint. Blank means "no single default" (e.g. Midjourney relays). */
  readonly defaultBaseURL: string
  /** Default model id. Blank means the user must supply one. */
  readonly defaultModel: string
}

export const IMAGE_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock（占位）',
    protocol: 'mock',
    defaultBaseURL: '',
    defaultModel: 'mock-image',
  },
  {
    id: 'gpt-image',
    label: 'GPT Image',
    protocol: 'openai-compatible',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-image-2',
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana（Gemini 2.5 Flash Image）',
    protocol: 'gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash-image',
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    protocol: 'midjourney',
    defaultBaseURL: '',
    defaultModel: '',
  },
  {
    id: 'seedream',
    label: 'Seedream（火山方舟）',
    protocol: 'volcengine',
    defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
  },
]

export const VIDEO_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock（占位）',
    protocol: 'mock',
    defaultBaseURL: '',
    defaultModel: 'mock-video',
  },
]

/** Sentinel value: routes to the settings-supplied protocol/baseURL/model. */
export const CUSTOM_PROVIDER_ID = 'custom'

export function findPreset(
  presets: readonly ProviderPreset[],
  id: string,
): ProviderPreset | undefined {
  return presets.find((preset) => preset.id === id)
}

/** Ids the settings card offers, including the trailing custom option. */
export function presetIds(presets: readonly ProviderPreset[]): string[] {
  return [...presets.map((preset) => preset.id), CUSTOM_PROVIDER_ID]
}

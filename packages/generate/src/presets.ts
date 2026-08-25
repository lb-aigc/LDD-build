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
 *
 * `strengths` is the routing hint the Host injects into the `generate_*` tool
 * description so the agent can auto-route a request to the best model without
 * the user switching anything. Keep it one short phrase per preset.
 */

export const PROVIDER_PROTOCOLS = [
  'mock',
  'openai-compatible',
  'gemini',
  'midjourney',
  'volcengine',
  'kie',
  'legnext',
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
  /** One-phrase routing hint fed to the agent's tool description. */
  readonly strengths: string
}

export const IMAGE_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock（占位）',
    protocol: 'mock',
    defaultBaseURL: '',
    defaultModel: 'mock-image',
    strengths: '占位模型，返回占位图，用于验证链路',
  },
  {
    id: 'gpt-image',
    label: 'GPT Image',
    protocol: 'openai-compatible',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-image-2',
    strengths: '通用写实与风格化图像，指令遵循和文字渲染强',
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana（Gemini 2.5 Flash Image）',
    protocol: 'gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash-image',
    strengths: '带文字的设计：logo、UI 图标、信息图、排版',
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    protocol: 'midjourney',
    defaultBaseURL: '',
    defaultModel: '',
    strengths: '艺术风格、概念插画、氛围感画面',
  },
  {
    id: 'seedream',
    label: 'Seedream（火山方舟）',
    protocol: 'volcengine',
    defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
    strengths: '中文场景、写实人像、电商产品图',
  },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    protocol: 'kie',
    defaultBaseURL: 'https://api.kie.ai',
    defaultModel: 'bytedance/seedream',
    strengths: '聚合中转：一个 key 调 Seedream/Nano Banana/GPT Image 等几十个图像模型',
  },
  {
    id: 'legnext',
    label: 'Legnext（MJ 中转）',
    protocol: 'legnext',
    defaultBaseURL: 'https://api.legnext.ai/api',
    defaultModel: '8.2',
    strengths: 'Midjourney 中转：艺术风格、概念插画、氛围感画面（V7/V8.1/V8.2）',
  },
]

export const VIDEO_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock（占位）',
    protocol: 'mock',
    defaultBaseURL: '',
    defaultModel: 'mock-video',
    strengths: '占位模型，返回占位视频，用于验证链路',
  },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    protocol: 'kie',
    defaultBaseURL: 'https://api.kie.ai',
    defaultModel: 'bytedance/seedance-2-5',
    strengths: '聚合中转：一个 key 调 Seedance/Kling/Wan/Hailuo 等几十个视频模型',
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

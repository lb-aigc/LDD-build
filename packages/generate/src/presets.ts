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
  'suno',
] as const

export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number]

/** One capability exposed by an aggregator preset (e.g. KIE's many models). */
export interface PresetModel {
  /** The exact capability id sent to the provider. */
  readonly id: string
  /** Human label shown in the picker and the agent's catalog. */
  readonly label: string
  /** Distinct image-to-image capability id; omitted when the model reuses its
   *  own id for i2i, or has no i2i at all. */
  readonly i2iModel?: string
}

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
  /** Whether the protocol supports image-to-image generation. Midjourney relays
   *  are false — their i2i consistency is too poor to be worth exposing. */
  readonly imageToImage: boolean
  /**
   * Aggregator model list. When present, ONE configured entry of this provider
   * EXPANDS into N routable models (one per capability), so a single API key
   * reaches every model and the composer picker lists them all. Absent (or for
   * a non-aggregator), one entry = one model. `defaultModel` is the preset's
   * first/default capability; `imageToImage` describes the protocol family.
   */
  readonly models?: readonly PresetModel[]
}

export const IMAGE_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock（占位）',
    protocol: 'mock',
    defaultBaseURL: '',
    defaultModel: 'mock-image',
    strengths: '占位模型，返回占位图，用于验证链路',
    imageToImage: true,
  },
  {
    id: 'gpt-image',
    label: 'GPT Image',
    protocol: 'openai-compatible',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-image-2',
    strengths: '通用写实与风格化图像，指令遵循和文字渲染强',
    imageToImage: true,
    models: [
      { id: 'gpt-image-2', label: 'GPT Image 2' },
      { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
    ],
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana（Gemini 2.5 Flash Image）',
    protocol: 'gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash-image',
    strengths: '带文字的设计：logo、UI 图标、信息图、排版',
    imageToImage: true,
    models: [
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
    ],
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    protocol: 'midjourney',
    defaultBaseURL: '',
    defaultModel: '',
    strengths: '艺术风格、概念插画、氛围感画面',
    imageToImage: false,
  },
  {
    id: 'seedream',
    label: 'Seedream（火山方舟）',
    protocol: 'volcengine',
    defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
    strengths: '中文场景、写实人像、电商产品图',
    imageToImage: true,
  },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    protocol: 'kie',
    defaultBaseURL: 'https://api.kie.ai',
    defaultModel: 'gpt-image-2-text-to-image',
    strengths: '聚合中转：一个 key 调 Seedream/Nano Banana/GPT Image/Flux/Grok 等几十个图像模型',
    imageToImage: true,
    // One configured KIE entry expands into all these capabilities: a single
    // key reaches every model, the composer picker lists them all, and the
    // agent routes to a specific one by name.
    models: [
      { id: 'gpt-image-2-text-to-image', label: 'GPT Image 2', i2iModel: 'gpt-image-2-image-to-image' },
      { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
      { id: 'nano-banana-2', label: 'Nano Banana 2' },
      { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite' },
      { id: 'bytedance/seedream', label: 'Seedream 4.0' },
      { id: 'seedream/5-pro-text-to-image', label: 'Seedream 5.0 Pro', i2iModel: 'seedream/5-pro-image-to-image' },
      { id: 'seedream/5-lite-text-to-image', label: 'Seedream 5.0 Lite', i2iModel: 'seedream/5-lite-image-to-image' },
      { id: 'flux-2/pro-text-to-image', label: 'Flux-2 Pro', i2iModel: 'flux-2/pro-image-to-image' },
      { id: 'flux-2/flex-text-to-image', label: 'Flux-2', i2iModel: 'flux-2/flex-image-to-image' },
      { id: 'z-image', label: 'Z-image' },
      { id: 'grok-imagine/text-to-image', label: 'Grok Imagine', i2iModel: 'grok-imagine/image-to-image' },
    ],
  },
  {
    id: 'legnext',
    label: 'Legnext（MJ 中转）',
    protocol: 'legnext',
    defaultBaseURL: 'https://api.legnext.ai/api',
    defaultModel: '8.2',
    strengths: 'Midjourney 中转：艺术风格、概念插画、氛围感画面（V7/V8.1/V8.2）',
    imageToImage: false,
    models: [
      { id: '8.2', label: 'MJ V8.2' },
      { id: '8.1', label: 'MJ V8.1' },
      { id: '7', label: 'MJ V7' },
    ],
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
    imageToImage: false,
  },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    protocol: 'kie',
    defaultBaseURL: 'https://api.kie.ai',
    defaultModel: 'bytedance/seedance-2-5',
    strengths: '聚合中转：一个 key 调 Seedance/Kling/Wan/Hailuo 等几十个视频模型',
    imageToImage: false,
  },
]

export const MUSIC_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock（占位）',
    protocol: 'mock',
    defaultBaseURL: '',
    defaultModel: 'mock-music',
    strengths: '占位模型，返回占位音乐，用于验证链路',
    imageToImage: false,
  },
  {
    id: 'suno',
    label: 'Suno（KIE 音乐）',
    protocol: 'suno',
    defaultBaseURL: 'https://api.kie.ai',
    defaultModel: 'V5_5',
    strengths: 'AI 音乐生成：作词作曲、纯音乐、多风格多语言（V4/V4.5/V5/V5.5）',
    imageToImage: false,
    models: [
      { id: 'V5_5', label: 'V5.5' },
      { id: 'V5', label: 'V5' },
      { id: 'V4_5PLUS', label: 'V4.5+' },
      { id: 'V4_5', label: 'V4.5' },
      { id: 'V4_5ALL', label: 'V4.5 ALL' },
      { id: 'V4', label: 'V4' },
    ],
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

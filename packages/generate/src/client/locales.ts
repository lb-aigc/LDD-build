/** Locale dictionaries for the generation settings cards (zh + en). */

export type GenerateLocaleKey =
  | 'imageTitle' | 'videoTitle'
  | 'defaultLabel' | 'custom' | 'remove' | 'addModel'
  | 'provider' | 'protocol' | 'protocolHint'
  | 'model' | 'modelHint'
  | 'baseURL' | 'baseURLHint'
  | 'apiKeyEnv' | 'apiKeyEnvHint'
  | 'apiKey' | 'apiKeyHint'
  | 'unsaved' | 'save' | 'saving' | 'discard' | 'readOnly' | 'saveFailed'
  | 'skillPicker.label' | 'skillPicker.loading' | 'skillPicker.empty' | 'skillPicker.userOnly'

export const zh: Record<GenerateLocaleKey, string> = {
  imageTitle: '生图模型',
  videoTitle: '生视频模型',
  defaultLabel: '默认',
  custom: '自定义',
  remove: '删除',
  addModel: '+ 添加模型',
  provider: '服务预设',
  protocol: '协议',
  protocolHint: 'openai-compatible / gemini / midjourney / volcengine',
  model: '模型',
  modelHint: '留空继承预设默认',
  baseURL: '接口地址',
  baseURLHint: '留空继承预设默认',
  apiKeyEnv: '密钥引用名',
  apiKeyEnvHint: '环境变量名或凭证引用，默认 GENERATE_API_KEY',
  apiKey: 'API Key',
  apiKeyHint: '留空则不修改',
  unsaved: '未保存',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  readOnly: '该配置只读，无法在此修改。',
  saveFailed: '保存失败，请重试。',
  'skillPicker.label': '技能',
  'skillPicker.loading': '加载中…',
  'skillPicker.empty': '暂无技能',
  'skillPicker.userOnly': '仅用户',
}

export const en: Record<GenerateLocaleKey, string> = {
  imageTitle: 'Image model',
  videoTitle: 'Video model',
  defaultLabel: 'Default',
  custom: 'Custom',
  remove: 'Remove',
  addModel: '+ Add model',
  provider: 'Provider',
  protocol: 'Protocol',
  protocolHint: 'openai-compatible / gemini / midjourney / volcengine',
  model: 'Model',
  modelHint: 'Blank inherits the preset default',
  baseURL: 'Endpoint',
  baseURLHint: 'Blank inherits the preset default',
  apiKeyEnv: 'Key reference',
  apiKeyEnvHint: 'Env var or credential reference; defaults to GENERATE_API_KEY',
  apiKey: 'API Key',
  apiKeyHint: 'Leave blank to keep unchanged',
  unsaved: 'Unsaved',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  readOnly: 'This configuration is read-only.',
  saveFailed: 'Save failed, please retry.',
  'skillPicker.label': 'Skills',
  'skillPicker.loading': 'Loading…',
  'skillPicker.empty': 'No skills',
  'skillPicker.userOnly': 'user-only',
}

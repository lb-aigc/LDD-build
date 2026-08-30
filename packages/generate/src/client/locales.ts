/** Locale dictionaries for the generation settings cards (zh + en). */

export type GenerateLocaleKey =
  | 'imageTitle' | 'videoTitle'
  | 'defaultLabel' | 'custom' | 'remove' | 'addModel'
  | 'provider' | 'protocol' | 'protocolHint'
  | 'model' | 'modelHint'
  | 'imageToImageModel' | 'imageToImageModelHint'
  | 'baseURL' | 'baseURLHint'
  | 'apiKeyEnv' | 'apiKeyEnvHint'
  | 'apiKey' | 'apiKeyHint'
  | 'unsaved' | 'save' | 'saving' | 'discard' | 'readOnly' | 'saveFailed'
  | 'fileImport.commandDescription' | 'fileImport.optionLabel' | 'fileImport.optionDetail' | 'fileImport.remove'

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
  imageToImageModel: '图生图模型（可选）',
  imageToImageModelHint: '留空则与文生图模型相同；KIE 填如 gpt-image-2-image-to-image；Nano Banana 系列无需配置（同一模型自动支持图生图）',
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
  'fileImport.commandDescription': '上传文件到工作区（视频/图片/文档/文本）',
  'fileImport.optionLabel': '选择文件',
  'fileImport.optionDetail': '从本地选择文件导入到当前工作区',
  'fileImport.remove': '移除文件卡片',
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
  imageToImageModel: 'Image-to-image model (optional)',
  imageToImageModelHint: 'Blank reuses the text-to-image model; e.g. gpt-image-2-image-to-image for KIE; Nano Banana needs no config (same model auto-supports i2i)',
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
  'fileImport.commandDescription': 'Upload files to the workspace (video/image/document/text)',
  'fileImport.optionLabel': 'Choose file',
  'fileImport.optionDetail': 'Import a local file into the current workspace',
  'fileImport.remove': 'Remove file card',
}

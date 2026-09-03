/** Locale dictionaries for the generation settings cards (zh + en). */

export type GenerateLocaleKey =
  | 'imageTitle' | 'videoTitle' | 'musicTitle'
  | 'keyListHint' | 'keyPlaceholder' | 'configured' | 'unconfigured'
  | 'unsaved' | 'save' | 'saving' | 'discard' | 'readOnly' | 'saveFailed'
  | 'fileImport.commandDescription' | 'fileImport.optionLabel' | 'fileImport.optionDetail' | 'fileImport.remove'
  | 'modelPicker.trigger'

export const zh: Record<GenerateLocaleKey, string> = {
  imageTitle: '生图模型',
  videoTitle: '生视频模型',
  musicTitle: '生音乐模型',
  keyListHint: '填写各中转的 API Key，配好后该中转的全部模型会出现在输入框上方的模型选择器里。',
  keyPlaceholder: '粘贴 API Key（留空则不修改）',
  configured: '已配置',
  unconfigured: '未配置',
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
  'modelPicker.trigger': '切换生图模型',
}

export const en: Record<GenerateLocaleKey, string> = {
  imageTitle: 'Image model',
  videoTitle: 'Video model',
  musicTitle: 'Music model',
  keyListHint: 'Fill in each relay API key; its models then appear in the picker above the composer.',
  keyPlaceholder: 'Paste the API key (blank = leave unchanged)',
  configured: 'Configured',
  unconfigured: 'Not set',
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
  'modelPicker.trigger': 'Switch generation model',
}

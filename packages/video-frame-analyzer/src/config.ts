export const supportedVideoFormats = ['mp4', 'mov', 'mkv', 'webm'] as const
export type VideoFormat = (typeof supportedVideoFormats)[number]

export const maxVideoFileBytes = 2 * 1024 * 1024 * 1024
export const maxAnalysisDurationSeconds = 60 * 60
export const maxFramesPerBatch = 36
export const maxFramesPerAnalysis = 144
export const maxFramesPerContactSheet = 9
export const maxContactSheetsPerAnalysis = 16

export type AnalysisPrecision = 'low' | 'balanced' | 'high'

export interface VideoAnalyzerConfig {
  readonly provider: string
  readonly model: string
  readonly precision: AnalysisPrecision
}

export const defaultVideoAnalyzerConfig: VideoAnalyzerConfig = Object.freeze({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash-vision-exp',
  precision: 'balanced',
})

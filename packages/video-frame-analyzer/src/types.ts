import type { AnalysisPrecision, VideoFormat } from './config.ts'

declare const analysisIdBrand: unique symbol
export type VideoAnalysisId = string & { readonly [analysisIdBrand]: true }

export interface AnalyzeVideoInput {
  readonly path: string
  readonly goal: string
  readonly startSeconds?: number
  readonly endSeconds?: number
  readonly precision?: AnalysisPrecision
}

export interface VideoImageRef {
  readonly attachmentId: string
  readonly mediaType: 'image/jpeg'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export type VisionContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: VideoImageRef }

export interface VisionMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly VisionContentBlock[]
  readonly source: { readonly kind: 'plugin'; readonly plugin: 'ldd-video-frame-analyzer' }
}

export interface VideoAnalysisInputRecord {
  readonly version: 1
  readonly analysisId: VideoAnalysisId
  readonly batchIndex: number
  readonly route: { readonly provider: string; readonly model: string }
  readonly goal: string
  readonly range: { readonly startSeconds: number; readonly endSeconds: number }
  readonly sampling: {
    readonly precision: AnalysisPrecision
    readonly intervalSeconds: number
    readonly timestamps: readonly number[]
  }
  readonly contactSheets: readonly VideoImageRef[]
  readonly system: string
  readonly messages: readonly VisionMessage[]
  readonly maxTokens: number
}

export interface VideoObservation {
  readonly startSeconds: number
  readonly endSeconds: number
  readonly summary: string
  readonly visibleText: readonly string[]
  readonly evidenceTimestamps: readonly number[]
  readonly confidence: 'low' | 'medium' | 'high'
}

export interface VideoInterval {
  readonly startSeconds: number
  readonly endSeconds: number
}

export interface AnalyzeVideoResult {
  readonly analysisId: VideoAnalysisId
  readonly metadata: {
    readonly durationSeconds: number
    readonly width: number
    readonly height: number
    readonly frameRate: number
    readonly hasAudio: boolean
    readonly format: VideoFormat
  }
  readonly strategy: {
    readonly precision: AnalysisPrecision
    readonly intervalSeconds: number
    readonly frameCount: number
    readonly contactSheetCount: number
    readonly truncated: boolean
  }
  readonly observations: readonly VideoObservation[]
  readonly coverage: {
    readonly analyzedRange: VideoInterval
    readonly uncoveredIntervals: readonly VideoInterval[]
  }
  readonly contactSheets: readonly VideoImageRef[]
  /** Strict FFmpeg failures abort analysis; successful strict decodes report an empty list. */
  readonly decodeWarnings: readonly string[]
  readonly warnings: readonly string[]
  readonly provider: string
  readonly model: string
  readonly requestCount: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact model-visible input recorded before one nested video-vision request. */
    'video/analysis-input': VideoAnalysisInputRecord
  }
}

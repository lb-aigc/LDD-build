import {
  maxAnalysisDurationSeconds,
  maxFramesPerAnalysis,
  maxFramesPerBatch,
  type AnalysisPrecision,
} from './config.ts'
import type { VideoMetadata } from './media-probe.ts'

export interface VideoRange {
  readonly startSeconds?: number
  readonly endSeconds?: number
}

export interface SampleBatch {
  readonly index: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly timestamps: readonly number[]
}

export interface VideoSamplingResult {
  readonly intervalSeconds: number
  readonly timestamps: readonly number[]
  readonly batches: readonly SampleBatch[]
  readonly truncated: boolean
  readonly warnings: readonly string[]
}

export function resolveBaseInterval(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('video duration must be positive and finite')
  }
  if (durationSeconds < 30) return 1
  if (durationSeconds <= 300) return 3
  return 10
}

export function sampleVideo(
  metadata: VideoMetadata,
  range: VideoRange,
  precision: AnalysisPrecision,
  sceneTimestamps: readonly number[] = [],
): VideoSamplingResult {
  validateMetadata(metadata)
  const selectedRange = resolveVideoRange(metadata.durationSeconds, range)
  const intervalSeconds = resolveBaseInterval(metadata.durationSeconds) * precisionMultiplier(precision)
  const intervalCandidates = generateIntervalTimestamps(
    selectedRange.startSeconds,
    selectedRange.endSeconds,
    intervalSeconds,
  )
  const scenes = normalizeSceneTimestamps(sceneTimestamps, selectedRange)
  const selectedScenes = selectEvenly(scenes, maxFramesPerAnalysis)
  const sceneIdentities = new Set(selectedScenes.map(timestampIdentity))
  const remaining = intervalCandidates.filter((value) => !sceneIdentities.has(timestampIdentity(value)))
  const selectedIntervals = selectEvenly(remaining, maxFramesPerAnalysis - selectedScenes.length)
  const timestamps = [...selectedScenes, ...selectedIntervals].sort((left, right) => left - right)
  const sourceCount = new Set([...scenes, ...intervalCandidates].map(timestampIdentity)).size
  const batches = chunk(timestamps, maxFramesPerBatch).map((values, index) => ({
    index,
    startSeconds: values[0] as number,
    endSeconds: values[values.length - 1] as number,
    timestamps: values,
  }))
  const truncated = sourceCount > timestamps.length
  return {
    intervalSeconds,
    timestamps,
    batches,
    truncated,
    warnings: truncated ? ['Sampling was capped at 144 frames; scene timestamps were prioritized.'] : [],
  }
}

export function resolveVideoRange(durationSeconds: number, range: VideoRange): {
  readonly startSeconds: number
  readonly endSeconds: number
} {
  const startSeconds = range.startSeconds ?? 0
  const endSeconds = range.endSeconds ?? durationSeconds
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0 ||
    endSeconds <= startSeconds ||
    endSeconds > durationSeconds
  ) {
    throw new Error('video range is invalid')
  }
  if (
    durationSeconds > maxAnalysisDurationSeconds &&
    (range.startSeconds === undefined ||
      range.endSeconds === undefined ||
      endSeconds - startSeconds > maxAnalysisDurationSeconds)
  ) {
    throw new Error('videos above 60 minutes require an explicit range no wider than 60 minutes')
  }
  return { startSeconds, endSeconds }
}

function precisionMultiplier(precision: AnalysisPrecision): number {
  switch (precision) {
    case 'low': return 2
    case 'balanced': return 1
    case 'high': return 0.5
  }
}

function generateIntervalTimestamps(start: number, end: number, interval: number): number[] {
  const timestamps: number[] = []
  for (let timestamp = start; timestamp < end; timestamp += interval) {
    timestamps.push(roundTimestamp(timestamp))
    if (timestamps.length > 1_000_000) throw new Error('sampling candidate count exceeded the safety limit')
  }
  return timestamps
}

function normalizeSceneTimestamps(
  values: readonly number[],
  range: { readonly startSeconds: number; readonly endSeconds: number },
): number[] {
  const unique = new Map<string, number>()
  for (const value of values) {
    if (!Number.isFinite(value) || value < range.startSeconds || value >= range.endSeconds) continue
    const rounded = roundTimestamp(value)
    unique.set(timestampIdentity(rounded), rounded)
  }
  return [...unique.values()].sort((left, right) => left - right)
}

function selectEvenly(values: readonly number[], limit: number): number[] {
  if (limit <= 0) return []
  if (values.length <= limit) return [...values]
  if (limit === 1) return [values[0] as number]
  const selected: number[] = []
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (values.length - 1)) / (limit - 1))
    selected.push(values[sourceIndex] as number)
  }
  return selected
}

function chunk(values: readonly number[], size: number): number[][] {
  const result: number[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function timestampIdentity(value: number): string {
  return value.toFixed(3)
}

function roundTimestamp(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function validateMetadata(metadata: VideoMetadata): void {
  resolveBaseInterval(metadata.durationSeconds)
  for (const [field, value] of [
    ['width', metadata.width],
    ['height', metadata.height],
    ['frame rate', metadata.frameRate],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`video ${field} is invalid`)
  }
}

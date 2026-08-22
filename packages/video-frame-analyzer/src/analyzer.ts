import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

import { planContactSheets, type PlannedContactSheet } from './contact-sheet.ts'
import type { AnalysisPrecision } from './config.ts'
import type { VideoMetadata } from './media-probe.ts'
import { resolveVideoRange, sampleVideo, type VideoRange } from './sampling.ts'
import type { TempMediaContext } from './temp-media.ts'
import type {
  AnalyzeVideoInput,
  AnalyzeVideoResult,
  VideoAnalysisId,
  VideoAnalysisInputRecord,
  VideoImageRef,
  VideoObservation,
  VisionMessage,
} from './types.ts'

const maxGoalCharacters = 4_000
const maxVisionResponseBytes = 1024 * 1024
const maxVisionTokens = 16_384
const maxObservationsPerBatch = 128
const maxVisibleTextItems = 128
const maxWarningsPerBatch = 64
const maxTextCharacters = 8_000

const visionSystem = `Analyze the supplied timestamped video contact sheets for the user's stated goal.
Return exactly one JSON object and no Markdown. The object must contain:
- observations: an array of {startSeconds, endSeconds, summary, visibleText, evidenceTimestamps, confidence}
- warnings: an array of strings
Use only evidence visible in the supplied sheets. confidence must be low, medium, or high. Keep observations chronological and cite exact visible timestamps.`

export interface ResolvedVideoAnalyzerConfig {
  readonly provider: string
  readonly model: string
  readonly defaultPrecision: AnalysisPrecision
  readonly maxTokens: number
  readonly timeoutMs: number
}

export interface VideoAnalyzerDependencies {
  readonly config: ResolvedVideoAnalyzerConfig
  resolveInput(path: string, signal: AbortSignal): Promise<string>
  probe(path: string, signal: AbortSignal): Promise<VideoMetadata>
  prepareVision(signal: AbortSignal): Promise<PreparedVideoVisionCall>
  withTemp<T>(taskId: string, task: (media: TempMediaContext) => Promise<T>): Promise<T>
  detectScenes(path: string, range: Required<VideoRange>, media: TempMediaContext): Promise<readonly number[]>
  renderContactSheet(
    inputPath: string,
    plan: PlannedContactSheet,
    media: TempMediaContext,
  ): Promise<void>
  decodeWarnings(media: TempMediaContext): readonly string[]
  saveContactSheet(path: string, name: string, signal: AbortSignal): Promise<VideoImageRef>
  recordInput(record: VideoAnalysisInputRecord): void
}

export interface PreparedVideoVisionCall {
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
  invoke(record: VideoAnalysisInputRecord, signal: AbortSignal): Promise<string>
}

export async function analyzeVideo(
  input: AnalyzeVideoInput,
  signal: AbortSignal,
  dependencies: VideoAnalyzerDependencies,
): Promise<AnalyzeVideoResult> {
  signal.throwIfAborted()
  const normalized = normalizeInput(input, dependencies.config.defaultPrecision)
  assertResolvedConfig(dependencies.config)
  const processPath = await dependencies.resolveInput(normalized.path, signal)
  const metadata = await dependencies.probe(processPath, signal)
  const requestedRange: VideoRange = {
    ...(normalized.startSeconds === undefined ? {} : { startSeconds: normalized.startSeconds }),
    ...(normalized.endSeconds === undefined ? {} : { endSeconds: normalized.endSeconds }),
  }
  const selectedRange = resolveVideoRange(metadata.durationSeconds, requestedRange)
  const firstPrepared = await dependencies.prepareVision(signal)
  assertPreparedVisionCall(firstPrepared, dependencies.config)
  const analysisId = randomUUID() as VideoAnalysisId

  return await dependencies.withTemp(analysisId, async (media) => {
    signal.throwIfAborted()
    const scenes = await dependencies.detectScenes(processPath, selectedRange, media)
    const sampling = sampleVideo(
      metadata,
      selectedRange,
      normalized.precision,
      scenes,
    )
    const sheets = planContactSheets(processPath, sampling.timestamps, media.path)
    const persisted: Array<{ readonly plan: PlannedContactSheet; readonly ref: VideoImageRef }> = []
    for (const sheet of sheets) {
      signal.throwIfAborted()
      await dependencies.renderContactSheet(processPath, sheet, media)
      const ref = await dependencies.saveContactSheet(
        sheet.outputPath,
        basename(sheet.outputPath),
        signal,
      )
      persisted.push({ plan: sheet, ref })
    }

    const observations: VideoObservation[] = []
    const warnings = [...sampling.warnings]
    let requestCount = 0
    const sheetBatches = chunk(persisted, 4)
    for (const [sheetBatchIndex, batch] of sheetBatches.entries()) {
      signal.throwIfAborted()
      const prepared = sheetBatchIndex === 0
        ? firstPrepared
        : await dependencies.prepareVision(signal)
      assertPreparedVisionCall(prepared, dependencies.config)
      const batchTimestamps = batch.flatMap((sheet) => sheet.plan.timestamps)
      const batchIndex = requestCount
      const nextBatchStart = sheetBatches[sheetBatchIndex + 1]?.[0]?.plan.timestamps[0]
      const record = createInputRecord({
        analysisId,
        batchIndex,
        config: prepared,
        goal: normalized.goal,
        precision: normalized.precision,
        intervalSeconds: sampling.intervalSeconds,
        timestamps: batchTimestamps,
        contactSheets: batch.map((sheet) => sheet.ref),
        startSeconds: batchTimestamps[0] ?? normalized.startSeconds ?? 0,
        endSeconds:
          nextBatchStart ??
          normalized.endSeconds ??
          metadata.durationSeconds,
      })
      dependencies.recordInput(record)
      signal.throwIfAborted()
      const output = await prepared.invoke(record, signal)
      const parsed = parseVisionOutput(output, record.range, batchIndex)
      observations.push(...parsed.observations)
      warnings.push(...parsed.warnings)
      requestCount += 1
    }

    observations.sort((left, right) =>
      left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds,
    )
    return {
      analysisId,
      metadata,
      strategy: {
        precision: normalized.precision,
        intervalSeconds: sampling.intervalSeconds,
        frameCount: sampling.timestamps.length,
        contactSheetCount: persisted.length,
        truncated: sampling.truncated,
      },
      observations,
      coverage: {
        analyzedRange: selectedRange,
        uncoveredIntervals: uncoveredIntervals(selectedRange, observations),
      },
      contactSheets: persisted.map((sheet) => sheet.ref),
      decodeWarnings: uniqueBoundedStrings(dependencies.decodeWarnings(media), maxWarningsPerBatch),
      warnings: uniqueBoundedStrings(warnings, maxWarningsPerBatch * Math.max(1, requestCount)),
      provider: firstPrepared.provider,
      model: firstPrepared.model,
      requestCount,
    }
  })
}

function uncoveredIntervals(
  range: { readonly startSeconds: number; readonly endSeconds: number },
  observations: readonly VideoObservation[],
): Array<{ readonly startSeconds: number; readonly endSeconds: number }> {
  const covered = observations
    .map((observation) => ({
      startSeconds: Math.max(range.startSeconds, observation.startSeconds),
      endSeconds: Math.min(range.endSeconds, observation.endSeconds),
    }))
    .filter((interval) => interval.endSeconds > interval.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds)
  const uncovered: Array<{ readonly startSeconds: number; readonly endSeconds: number }> = []
  let cursor = range.startSeconds
  for (const interval of covered) {
    if (interval.startSeconds > cursor) {
      uncovered.push({ startSeconds: cursor, endSeconds: interval.startSeconds })
    }
    cursor = Math.max(cursor, interval.endSeconds)
  }
  if (cursor < range.endSeconds) uncovered.push({ startSeconds: cursor, endSeconds: range.endSeconds })
  return uncovered
}

interface CreateRecordInput {
  readonly analysisId: VideoAnalysisId
  readonly batchIndex: number
  readonly config: Pick<PreparedVideoVisionCall, 'provider' | 'model' | 'maxTokens'>
  readonly goal: string
  readonly precision: AnalysisPrecision
  readonly intervalSeconds: number
  readonly timestamps: readonly number[]
  readonly contactSheets: readonly VideoImageRef[]
  readonly startSeconds: number
  readonly endSeconds: number
}

function createInputRecord(input: CreateRecordInput): VideoAnalysisInputRecord {
  const route = { provider: input.config.provider, model: input.config.model }
  const range = { startSeconds: input.startSeconds, endSeconds: input.endSeconds }
  const userText = JSON.stringify({
    goal: input.goal,
    batchIndex: input.batchIndex,
    range,
    timestamps: input.timestamps,
  })
  const messages: VisionMessage[] = [{
    id: randomUUID(),
    role: 'user',
    content: [
      { type: 'text', text: userText },
      ...input.contactSheets.map((attachment) => ({ type: 'image' as const, attachment })),
    ],
    source: { kind: 'plugin', plugin: 'ldd-video-frame-analyzer' },
  }]
  return {
    version: 1,
    analysisId: input.analysisId,
    batchIndex: input.batchIndex,
    route,
    goal: input.goal,
    range,
    sampling: {
      precision: input.precision,
      intervalSeconds: input.intervalSeconds,
      timestamps: [...input.timestamps],
    },
    contactSheets: input.contactSheets.map((ref) => ({ ...ref })),
    system: visionSystem,
    messages,
    maxTokens: input.config.maxTokens,
  }
}

function normalizeInput(input: AnalyzeVideoInput, defaultPrecision: AnalysisPrecision): {
  readonly path: string
  readonly goal: string
  readonly startSeconds?: number
  readonly endSeconds?: number
  readonly precision: AnalysisPrecision
} {
  const path = input.path.trim()
  const goal = input.goal.trim()
  if (path.length === 0) throw new Error('video path must be a non-empty string')
  if (goal.length === 0 || goal.length > maxGoalCharacters) {
    throw new Error(`video analysis goal must contain 1-${maxGoalCharacters} characters`)
  }
  const precision = input.precision ?? defaultPrecision
  if (precision !== 'low' && precision !== 'balanced' && precision !== 'high') {
    throw new Error('video analysis precision must be low, balanced, or high')
  }
  return {
    path,
    goal,
    ...(input.startSeconds === undefined ? {} : { startSeconds: input.startSeconds }),
    ...(input.endSeconds === undefined ? {} : { endSeconds: input.endSeconds }),
    precision,
  }
}

function assertResolvedConfig(config: ResolvedVideoAnalyzerConfig): void {
  if (config.provider.length === 0 || config.model.length === 0) {
    throw new Error('video analyzer provider and model must be non-empty')
  }
  if (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0 || config.maxTokens > maxVisionTokens) {
    throw new Error(`video analyzer maxTokens must be an integer between 1 and ${maxVisionTokens}`)
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('video analyzer timeoutMs must be a positive integer')
  }
}

function assertPreparedVisionCall(
  prepared: PreparedVideoVisionCall,
  expected: ResolvedVideoAnalyzerConfig,
): void {
  if (
    prepared.provider !== expected.provider ||
    prepared.model !== expected.model ||
    prepared.maxTokens !== expected.maxTokens
  ) {
    throw new Error('prepared video vision call does not match the configured route')
  }
}

function parseVisionOutput(
  serialized: string,
  range: { readonly startSeconds: number; readonly endSeconds: number },
  batchIndex: number,
): { readonly observations: readonly VideoObservation[]; readonly warnings: readonly string[] } {
  if (Buffer.byteLength(serialized, 'utf8') > maxVisionResponseBytes) {
    return fallbackVisionOutput('', range, batchIndex, 'exceeded the 1 MiB response limit')
  }
  try {
    const root = requireRecord(JSON.parse(stripJsonFence(serialized)) as unknown, 'vision output')
    const rawObservations = requireArray(root.observations, 'vision observations')
    if (rawObservations.length > maxObservationsPerBatch) {
      throw new Error('vision observations exceed the item limit')
    }
    const observations = rawObservations.map((value, index) =>
      parseObservation(value, index, range),
    )
    const rawWarnings = requireArray(root.warnings, 'vision warnings')
    const warnings = uniqueBoundedStrings(
      rawWarnings.map((value) => boundedString(value, 'vision warning')),
      maxWarningsPerBatch,
    )
    return { observations, warnings }
  } catch {
    return fallbackVisionOutput(serialized, range, batchIndex, 'was not valid structured JSON')
  }
}

function parseObservation(
  value: unknown,
  index: number,
  range: { readonly startSeconds: number; readonly endSeconds: number },
): VideoObservation {
  const record = requireRecord(value, `vision observations[${index}]`)
  const startSeconds = finiteInRange(record.startSeconds, range, 'observation startSeconds')
  const endSeconds = finiteInRange(record.endSeconds, range, 'observation endSeconds')
  if (endSeconds < startSeconds) throw new Error('observation endSeconds precedes startSeconds')
  const confidence = record.confidence
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    throw new Error('observation confidence is invalid')
  }
  const visibleText = requireArray(record.visibleText, 'observation visibleText')
  if (visibleText.length > maxVisibleTextItems) throw new Error('observation visibleText exceeds the item limit')
  const evidence = requireArray(record.evidenceTimestamps, 'observation evidenceTimestamps')
  if (evidence.length > maxVisibleTextItems) throw new Error('observation evidence exceeds the item limit')
  return {
    startSeconds,
    endSeconds,
    summary: boundedString(record.summary, 'observation summary'),
    visibleText: visibleText.map((item) => boundedString(item, 'visible text')),
    evidenceTimestamps: evidence.map((item) => finiteInRange(item, range, 'evidence timestamp')),
    confidence,
  }
}

function fallbackVisionOutput(
  serialized: string,
  range: { readonly startSeconds: number; readonly endSeconds: number },
  batchIndex: number,
  reason: string,
): { readonly observations: readonly VideoObservation[]; readonly warnings: readonly string[] } {
  const safe = serialized
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000)
  return {
    observations: [{
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      summary: safe.length === 0
        ? 'Vision model returned an unstructured response with no usable text.'
        : `Vision model returned an unstructured response: ${safe}`,
      visibleText: [],
      evidenceTimestamps: [],
      confidence: 'low',
    }],
    warnings: [`Vision response for batch ${batchIndex + 1} ${reason}.`],
  }
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return fenced?.[1] ?? trimmed
}

function finiteInRange(
  value: unknown,
  range: { readonly startSeconds: number; readonly endSeconds: number },
  field: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < range.startSeconds ||
    value > range.endSeconds
  ) {
    throw new Error(`${field} is outside the analyzed range`)
  }
  return Math.round(value * 1_000) / 1_000
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxTextCharacters) {
    throw new Error(`${field} must contain 1-${maxTextCharacters} characters`)
  }
  return value
}

function uniqueBoundedStrings(values: readonly string[], limit: number): string[] {
  return [...new Set(values)].slice(0, limit)
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

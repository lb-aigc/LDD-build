export interface ValidatedVideoAnalysisTrace {
  readonly analysisId: string
  readonly batchIndex: number
  readonly provider: string
  readonly model: string
}

type Fail = (message: string) => never

export function validateVideoAnalysisInputRecord(
  value: unknown,
  fail: Fail = (message) => { throw new Error(message) },
): ValidatedVideoAnalysisTrace {
  const data = recordOf(value, 'data', fail)
  if (data.version !== 1) fail('video/analysis-input version must be 1')
  const analysisId = nonEmptyString(data.analysisId, 'analysisId', fail)
  const batchIndex = nonNegativeInteger(data.batchIndex, 'batchIndex', fail)
  const route = recordOf(data.route, 'route', fail)
  const provider = nonEmptyString(route.provider, 'route.provider', fail)
  const model = nonEmptyString(route.model, 'route.model', fail)
  const goal = nonEmptyString(data.goal, 'goal', fail)
  const range = recordOf(data.range, 'range', fail)
  const startSeconds = finiteNumber(range.startSeconds, 'range.startSeconds', fail)
  const endSeconds = finiteNumber(range.endSeconds, 'range.endSeconds', fail)
  if (startSeconds < 0 || endSeconds <= startSeconds) fail('video/analysis-input range is invalid')

  const sampling = recordOf(data.sampling, 'sampling', fail)
  if (sampling.precision !== 'low' && sampling.precision !== 'balanced' && sampling.precision !== 'high') {
    fail('video/analysis-input sampling.precision is invalid')
  }
  const intervalSeconds = finiteNumber(sampling.intervalSeconds, 'sampling.intervalSeconds', fail)
  if (intervalSeconds <= 0) fail('video/analysis-input sampling.intervalSeconds must be positive')
  const timestamps = arrayOf(sampling.timestamps, 'sampling.timestamps', fail)
    .map((entry) => finiteNumber(entry, 'sampling timestamp', fail))
  if (timestamps.length === 0 || timestamps.length > 144) {
    fail('video/analysis-input sampling.timestamps must carry 1-144 entries')
  }
  for (const [index, timestamp] of timestamps.entries()) {
    if (timestamp < startSeconds || timestamp >= endSeconds) {
      fail('video/analysis-input sampling timestamp is outside the range')
    }
    if (index > 0 && timestamp <= (timestamps[index - 1] as number)) {
      fail('video/analysis-input sampling timestamps must be strictly increasing')
    }
  }

  const sheets = arrayOf(data.contactSheets, 'contactSheets', fail)
    .map((entry, index) => validateImageRef(entry, `contactSheets[${index}]`, fail))
  if (sheets.length === 0 || sheets.length > 4) {
    fail('video/analysis-input must carry 1-4 contact sheets')
  }
  nonEmptyString(data.system, 'system', fail)
  const messages = arrayOf(data.messages, 'messages', fail)
  if (messages.length !== 1) fail('video/analysis-input must carry exactly one user message')
  const message = recordOf(messages[0], 'messages[0]', fail)
  nonEmptyString(message.id, 'messages[0].id', fail)
  if (message.role !== 'user') fail('video/analysis-input message role must be user')
  const source = recordOf(message.source, 'messages[0].source', fail)
  if (source.kind !== 'plugin' || source.plugin !== 'ldd-video-frame-analyzer') {
    fail('video/analysis-input message source is invalid')
  }
  const content = arrayOf(message.content, 'messages[0].content', fail)
  if (content.length !== sheets.length + 1) {
    fail('video/analysis-input message must contain one text block plus every contact sheet')
  }
  const textBlock = recordOf(content[0], 'messages[0].content[0]', fail)
  if (textBlock.type !== 'text' || typeof textBlock.text !== 'string') {
    fail('video/analysis-input first message block must be text')
  }
  const prompt = parseJsonRecord(textBlock.text, 'prompt', fail)
  if (prompt.goal !== goal || prompt.batchIndex !== batchIndex) {
    fail('video/analysis-input prompt identity does not match the record')
  }
  const promptRange = recordOf(prompt.range, 'prompt range', fail)
  if (promptRange.startSeconds !== startSeconds || promptRange.endSeconds !== endSeconds) {
    fail('video/analysis-input prompt range does not match the record')
  }
  const promptTimestamps = arrayOf(prompt.timestamps, 'prompt timestamps', fail)
  if (!samePrimitiveArray(promptTimestamps, timestamps)) {
    fail('video/analysis-input prompt timestamps do not match the record')
  }
  for (const [index, sheet] of sheets.entries()) {
    const block = recordOf(content[index + 1], `messages[0].content[${index + 1}]`, fail)
    if (block.type !== 'image') fail('video/analysis-input contact sheet block must be an image')
    const attachment = validateImageRef(block.attachment, `message contact sheet ${index}`, fail)
    if (!sameImageRef(attachment, sheet)) {
      fail('video/analysis-input message contact sheet does not match the record')
    }
  }
  const maxTokens = nonNegativeInteger(data.maxTokens, 'maxTokens', fail)
  if (maxTokens === 0 || maxTokens > 16_384) {
    fail('video/analysis-input maxTokens must be between 1 and 16384')
  }
  return { analysisId, batchIndex, provider, model }
}

interface CheckedImageRef {
  readonly attachmentId: string
  readonly mediaType: 'image/jpeg'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

function validateImageRef(value: unknown, field: string, fail: Fail): CheckedImageRef {
  const ref = recordOf(value, field, fail)
  const attachmentId = nonEmptyString(ref.attachmentId, `${field}.attachmentId`, fail)
  if (ref.mediaType !== 'image/jpeg') fail(`video/analysis-input ${field}.mediaType must be image/jpeg`)
  const bytes = positiveInteger(ref.bytes, `${field}.bytes`, fail)
  const width = positiveInteger(ref.width, `${field}.width`, fail)
  const height = positiveInteger(ref.height, `${field}.height`, fail)
  const name = ref.name === undefined ? undefined : nonEmptyString(ref.name, `${field}.name`, fail)
  return { attachmentId, mediaType: 'image/jpeg', bytes, width, height, ...(name === undefined ? {} : { name }) }
}

function sameImageRef(left: CheckedImageRef, right: CheckedImageRef): boolean {
  return left.attachmentId === right.attachmentId &&
    left.mediaType === right.mediaType &&
    left.bytes === right.bytes &&
    left.width === right.width &&
    left.height === right.height &&
    left.name === right.name
}

function parseJsonRecord(serialized: string, field: string, fail: Fail): Record<string, unknown> {
  try {
    return recordOf(JSON.parse(serialized) as unknown, field, fail)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`video/analysis-input ${field} is not valid JSON`)
    throw error
  }
}

function recordOf(value: unknown, field: string, fail: Fail): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`video/analysis-input ${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function arrayOf(value: unknown, field: string, fail: Fail): readonly unknown[] {
  if (!Array.isArray(value)) fail(`video/analysis-input ${field} must be an array`)
  return value
}

function nonEmptyString(value: unknown, field: string, fail: Fail): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`video/analysis-input ${field} must be a non-empty string`)
  }
  return value
}

function finiteNumber(value: unknown, field: string, fail: Fail): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`video/analysis-input ${field} must be finite`)
  }
  return value
}

function nonNegativeInteger(value: unknown, field: string, fail: Fail): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`video/analysis-input ${field} must be a non-negative safe integer`)
  }
  return value as number
}

function positiveInteger(value: unknown, field: string, fail: Fail): number {
  const result = nonNegativeInteger(value, field, fail)
  if (result === 0) fail(`video/analysis-input ${field} must be positive`)
  return result
}

function samePrimitiveArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

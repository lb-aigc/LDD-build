import { readFile } from 'node:fs/promises'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const runtimeStateKeys = new Set([
  'schemaVersion',
  'activeVersion',
  'lastKnownGoodVersion',
  'pendingVersion',
  'lastCheckAt',
  'channel',
])

export type RuntimeChannel = 'stable' | 'prerelease'

export interface RuntimeState {
  readonly schemaVersion: 1
  readonly activeVersion: string | null
  readonly lastKnownGoodVersion: string | null
  readonly pendingVersion: string | null
  readonly lastCheckAt: string | null
  readonly channel: RuntimeChannel
}

export interface RuntimeStateDiagnostic {
  readonly code: 'invalid-state' | 'read-failed'
  readonly message: string
}

export interface ReadRuntimeStateResult {
  readonly state: RuntimeState
  readonly diagnostics: readonly RuntimeStateDiagnostic[]
}

export function createDefaultRuntimeState(): RuntimeState {
  return {
    schemaVersion: 1,
    activeVersion: null,
    lastKnownGoodVersion: null,
    pendingVersion: null,
    lastCheckAt: null,
    channel: 'prerelease',
  }
}

export async function readRuntimeState(statePath: string): Promise<ReadRuntimeStateResult> {
  let serialized: string
  try {
    serialized = await readFile(statePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { state: createDefaultRuntimeState(), diagnostics: [] }
    }

    return {
      state: createDefaultRuntimeState(),
      diagnostics: [
        {
          code: 'read-failed',
          message: `Runtime state could not be read: ${safeErrorMessage(error)}`,
        },
      ],
    }
  }

  try {
    return { state: parseRuntimeState(JSON.parse(serialized) as unknown), diagnostics: [] }
  } catch (error) {
    return {
      state: createDefaultRuntimeState(),
      diagnostics: [
        {
          code: 'invalid-state',
          message: `Runtime state is invalid and was left untouched: ${safeErrorMessage(error)}`,
        },
      ],
    }
  }
}

export async function writeRuntimeState(statePath: string, state: RuntimeState): Promise<void> {
  await writeAtomicJson(statePath, parseRuntimeState(state))
}

export function parseRuntimeState(value: unknown): RuntimeState {
  if (!isRecord(value)) {
    throw new TypeError('expected an object')
  }
  for (const key of Object.keys(value)) {
    if (!runtimeStateKeys.has(key)) {
      throw new TypeError(`unexpected field ${key}`)
    }
  }
  if (value.schemaVersion !== 1) {
    throw new TypeError('schemaVersion must be 1')
  }
  if (value.channel !== 'stable' && value.channel !== 'prerelease') {
    throw new TypeError('channel must be stable or prerelease')
  }

  return {
    schemaVersion: 1,
    activeVersion: parseOptionalVersion(value.activeVersion, 'activeVersion'),
    lastKnownGoodVersion: parseOptionalVersion(
      value.lastKnownGoodVersion,
      'lastKnownGoodVersion',
    ),
    pendingVersion: parseOptionalVersion(value.pendingVersion, 'pendingVersion'),
    lastCheckAt: parseOptionalTimestamp(value.lastCheckAt),
    channel: value.channel,
  }
}

function parseOptionalVersion(value: unknown, field: string): string | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string' || !semanticVersionPattern.test(value)) {
    throw new TypeError(`${field} must be a semantic version or null`)
  }
  return value
}

function parseOptionalTimestamp(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError('lastCheckAt must be an ISO timestamp or null')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

import { readFile } from 'node:fs/promises'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'
import type { ImageMode } from './profile/image-mode.ts'

export interface LddSettings {
  readonly schemaVersion: 1
  readonly imageMode: ImageMode
}

export function createDefaultLddSettings(): LddSettings {
  return { schemaVersion: 1, imageMode: 'standard' }
}

export async function readLddSettings(settingsPath: string): Promise<LddSettings> {
  let serialized: string
  try {
    serialized = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return createDefaultLddSettings()
    }
    throw error
  }
  return parseLddSettings(JSON.parse(serialized) as unknown)
}

export async function writeLddSettings(
  settingsPath: string,
  settings: LddSettings,
): Promise<void> {
  await writeAtomicJson(settingsPath, parseLddSettings(settings))
}

export function parseLddSettings(value: unknown): LddSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('LDD settings must be an object')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'schemaVersion' && key !== 'imageMode') {
      throw new TypeError(`LDD settings contain unexpected field ${key}`)
    }
  }
  if (record.schemaVersion !== 1) {
    throw new TypeError('LDD settings schemaVersion must be 1')
  }
  if (record.imageMode !== 'standard' && record.imageMode !== 'large') {
    throw new TypeError('LDD settings imageMode must be standard or large')
  }
  return { schemaVersion: 1, imageMode: record.imageMode }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

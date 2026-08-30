/**
 * The LDD data-location bootstrap config: a tiny file at a FIXED location
 * (`%APPDATA%\LDD\location.json`) that records where the user wants LDD's
 * data (sessions, attachments, kernels, logs, cache) to live, independent of
 * where the program is installed. The file is deliberately NOT under the data
 * directory itself — the data directory is what it configures, so a
 * chicken-and-egg problem would otherwise follow (settings.json already lives
 * under the data root).
 *
 * When `dataDirectory` is absent the desktop falls back to the built-in
 * defaults (`%LOCALAPPDATA%\LDD` for kernels/logs/cache and
 * `%APPDATA%\LDD\harness` for sessions/attachments). Setting it relocates
 * BOTH: `dataRoot` becomes the chosen directory and `dshHome` becomes
 * `<chosen>\harness`.
 */

import { isAbsolute, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'

/** One data-location record. `dataDirectory` is an absolute directory or absent (built-in default). */
export interface DataLocation {
  readonly schemaVersion: 1
  readonly dataDirectory?: string
}

/** The fixed bootstrap-config path, derived from the roaming AppData root (never the data directory itself). */
export function locationFilePath(roamingAppData: string): string {
  return join(roamingAppData, 'LDD', 'location.json')
}

export function createDefaultDataLocation(): DataLocation {
  return { schemaVersion: 1 }
}

export function parseDataLocation(value: unknown): DataLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('LDD data location must be an object')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'schemaVersion' && key !== 'dataDirectory') {
      throw new TypeError(`LDD data location contains unexpected field ${key}`)
    }
  }
  if (record.schemaVersion !== 1) {
    throw new TypeError('LDD data location schemaVersion must be 1')
  }
  const dataDirectory = record.dataDirectory
  if (dataDirectory !== undefined) {
    if (typeof dataDirectory !== 'string' || dataDirectory.length === 0 || dataDirectory.length > 1024) {
      throw new TypeError('LDD data location dataDirectory is invalid')
    }
    if (!isAbsolute(dataDirectory)) {
      throw new TypeError('LDD data location dataDirectory must be an absolute path')
    }
  }
  return { schemaVersion: 1, ...(dataDirectory === undefined ? {} : { dataDirectory }) }
}

export async function readDataLocation(locationPath: string): Promise<DataLocation> {
  let serialized: string
  try {
    serialized = await readFile(locationPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return createDefaultDataLocation()
    }
    throw error
  }
  return parseDataLocationText(serialized)
}

/**
 * Parse the on-disk location config, which the NSIS installer writes as a bare
 * path (no JSON — the installer avoids backslash escaping) and the desktop
 * settings UI writes as a JSON object. A `{`-prefixed line is parsed as JSON;
 * any other non-blank line is the data directory itself.
 */
export function parseDataLocationText(text: string): DataLocation {
  const trimmed = text.trim()
  if (trimmed === '') return createDefaultDataLocation()
  if (trimmed.startsWith('{')) {
    return parseDataLocation(JSON.parse(trimmed) as unknown)
  }
  return parseDataLocation({ schemaVersion: 1, dataDirectory: trimmed })
}

export async function writeDataLocation(locationPath: string, location: DataLocation): Promise<void> {
  await writeAtomicJson(locationPath, parseDataLocation(location))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

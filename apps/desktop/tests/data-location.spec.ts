import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultDataLocation,
  locationFilePath,
  parseDataLocation,
  parseDataLocationText,
  readDataLocation,
  writeDataLocation,
} from '../src/main/data-location.js'

/** A platform-appropriate absolute data-directory fixture (drive letter on Windows, root path elsewhere). */
function absDataDir(name: string): string {
  return process.platform === 'win32' ? `D:/${name}` : `/${name}`
}

describe('data-location bootstrap config', () => {
  const temps: string[] = []
  afterEach(async () => {
    await Promise.all(temps.map((path) => rm(path, { recursive: true, force: true })))
  })

  async function makeDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ldd-location-'))
    temps.push(dir)
    return dir
  }

  it('derives the fixed location path from roaming AppData', () => {
    expect(locationFilePath('C:\\\\Users\\\\x\\\\AppData\\\\Roaming')).toBe(
      join('C:\\\\Users\\\\x\\\\AppData\\\\Roaming', 'LDD', 'location.json'),
    )
  })

  it('parses a valid record and defaults an absent one', () => {
    expect(createDefaultDataLocation()).toEqual({ schemaVersion: 1 })
    const dataDir = absDataDir('LDD')
    expect(parseDataLocation({ schemaVersion: 1, dataDirectory: dataDir })).toEqual({
      schemaVersion: 1,
      dataDirectory: dataDir,
    })
  })

  it('rejects unknown fields, wrong schema, and non-absolute directories', () => {
    expect(() => parseDataLocation({ schemaVersion: 1, nope: 1 })).toThrow('unexpected field')
    expect(() => parseDataLocation({ schemaVersion: 2 })).toThrow('schemaVersion')
    expect(() => parseDataLocation({ schemaVersion: 1, dataDirectory: 'relative/dir' })).toThrow('absolute')
    expect(() => parseDataLocation({ schemaVersion: 1, dataDirectory: 42 })).toThrow('invalid')
  })

  it('reads ENOENT as the default and round-trips a written record', async () => {
    const dir = await makeDir()
    const locationPath = join(dir, 'location.json')
    expect(await readDataLocation(locationPath)).toEqual({ schemaVersion: 1 })

    const dataDir = absDataDir('LDD Data')
    await writeDataLocation(locationPath, { schemaVersion: 1, dataDirectory: dataDir })
    expect(await readDataLocation(locationPath)).toEqual({
      schemaVersion: 1,
      dataDirectory: dataDir,
    })
    const raw = JSON.parse(await readFile(locationPath, 'utf8')) as Record<string, unknown>
    expect(raw.dataDirectory).toBe(dataDir)
  })

  it('parses the bare-path format the NSIS installer writes', () => {
    // The installer writes the directory as a bare line (no JSON, no backslash
    // escaping); a `{`-prefixed line is still JSON, anything else is the path.
    const dataDir = absDataDir('LDD')
    const myData = absDataDir('My Data')
    expect(parseDataLocationText(`${dataDir}\n`)).toEqual({ schemaVersion: 1, dataDirectory: dataDir })
    expect(parseDataLocationText(`  ${myData}  `)).toEqual({ schemaVersion: 1, dataDirectory: myData })
    expect(parseDataLocationText('')).toEqual({ schemaVersion: 1 })
    expect(parseDataLocationText(JSON.stringify({ schemaVersion: 1, dataDirectory: dataDir }))).toEqual({
      schemaVersion: 1,
      dataDirectory: dataDir,
    })
    expect(() => parseDataLocationText('relative/dir')).toThrow('absolute')
  })
})

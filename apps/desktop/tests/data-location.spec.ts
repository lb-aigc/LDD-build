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
    expect(locationFilePath('C:\\Users\\x\\AppData\\Roaming')).toBe(
      join('C:\\Users\\x\\AppData\\Roaming', 'LDD', 'location.json'),
    )
  })

  it('parses a valid record and defaults an absent one', () => {
    expect(createDefaultDataLocation()).toEqual({ schemaVersion: 1 })
    expect(parseDataLocation({ schemaVersion: 1, dataDirectory: 'D:/LDD' })).toEqual({
      schemaVersion: 1,
      dataDirectory: 'D:/LDD',
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

    await writeDataLocation(locationPath, { schemaVersion: 1, dataDirectory: 'E:/LDD Data' })
    expect(await readDataLocation(locationPath)).toEqual({
      schemaVersion: 1,
      dataDirectory: 'E:/LDD Data',
    })
    const raw = JSON.parse(await readFile(locationPath, 'utf8')) as Record<string, unknown>
    expect(raw.dataDirectory).toBe('E:/LDD Data')
  })

  it('parses the bare-path format the NSIS installer writes', () => {
    // The installer writes the directory as a bare line (no JSON, no backslash
    // escaping); a `{`-prefixed line is still JSON, anything else is the path.
    expect(parseDataLocationText('D:/LDD\n')).toEqual({ schemaVersion: 1, dataDirectory: 'D:/LDD' })
    expect(parseDataLocationText('  E:/My Data  ')).toEqual({ schemaVersion: 1, dataDirectory: 'E:/My Data' })
    expect(parseDataLocationText('')).toEqual({ schemaVersion: 1 })
    expect(parseDataLocationText('{"schemaVersion":1,"dataDirectory":"F:/LDD"}')).toEqual({
      schemaVersion: 1,
      dataDirectory: 'F:/LDD',
    })
    expect(() => parseDataLocationText('relative/dir')).toThrow('absolute')
  })
})

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDataDirectory } from '../src/main/data-migration.js'

describe('data-directory migration', () => {
  const temps: string[] = []
  afterEach(async () => {
    await Promise.all(temps.map((path) => rm(path, { recursive: true, force: true })))
  })

  async function makeDir(label: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `ldd-migrate-${label}-`))
    temps.push(dir)
    return dir
  }

  it('copies app data and sessions under the chosen directory, preserving sources', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = await makeDir('home')
    const target = join(await makeDir('target'), 'LDD')
    await writeFile(join(oldDataRoot, 'settings.json'), '{"schemaVersion":1}')
    await mkdir(join(oldDataRoot, 'runtime', 'versions'), { recursive: true })
    await writeFile(join(oldDataRoot, 'runtime', 'state.json'), '{}')
    await writeFile(join(oldDshHome, 'note.txt'), 'hello')

    const result = await migrateDataDirectory({ oldDataRoot, oldDshHome, newDataDirectory: target })

    expect(result.dataDirectory).toBe(target)
    expect(await readFile(join(result.dataRoot, 'settings.json'), 'utf8')).toContain('schemaVersion')
    expect(await readFile(join(result.dshHome, 'note.txt'), 'utf8')).toBe('hello')
    // Sources are copied, never moved.
    expect(await readFile(join(oldDataRoot, 'settings.json'), 'utf8')).toContain('schemaVersion')
    expect(await readFile(join(oldDshHome, 'note.txt'), 'utf8')).toBe('hello')
  })

  it('skips an absent sessions home and still lands app data', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = join(await makeDir('missing'), 'harness') // never created
    const target = join(await makeDir('target'), 'LDD')
    await writeFile(join(oldDataRoot, 'settings.json'), '{}')

    const result = await migrateDataDirectory({ oldDataRoot, oldDshHome, newDataDirectory: target })
    expect(await readFile(join(result.dataRoot, 'settings.json'), 'utf8')).toBe('{}')
    expect((await readdir(result.dshHome)).length).toBe(0)
  })

  it('rejects a non-empty target directory', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = await makeDir('home')
    const target = await makeDir('target')
    await writeFile(join(target, 'occupied.txt'), 'x')

    await expect(
      migrateDataDirectory({ oldDataRoot, oldDshHome, newDataDirectory: target }),
    ).rejects.toThrow('非空')
  })

  it('rejects a target that is an ancestor of the current data root', async () => {
    const base = await makeDir('base')
    const oldDataRoot = join(base, 'LDD')
    await mkdir(oldDataRoot, { recursive: true })
    const oldDshHome = await makeDir('home')

    await expect(
      migrateDataDirectory({ oldDataRoot, oldDshHome, newDataDirectory: base }),
    ).rejects.toThrow('父目录')
  })
})

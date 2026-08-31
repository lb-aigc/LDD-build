import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDataDirectory, migrateDataDirectoryIfNeeded } from '../src/main/data-migration.js'

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

  it('skips Harness node_modules (which holds runtime symlinks) instead of failing', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = await makeDir('home')
    const target = join(await makeDir('target'), 'LDD')
    await writeFile(join(oldDataRoot, 'settings.json'), '{}')
    // Harness keeps a profiles/node_modules tree with symlinks to the installed
    // runtime (created at boot; recreating them in a copy needs elevation and
    // fails EPERM on Windows). The migration must skip the top-level
    // profiles/node_modules tree entirely (it is regenerated from manifests),
    // never copying it into the target.
    await writeFile(join(oldDshHome, 'note.txt'), 'hello')
    const profilesNodeModules = join(oldDshHome, 'profiles', 'node_modules', '@anthropic-ai')
    await mkdir(profilesNodeModules, { recursive: true })
    await writeFile(join(profilesNodeModules, 'sdk'), 'runtime-link-target')

    const result = await migrateDataDirectory({ oldDataRoot, oldDshHome, newDataDirectory: target })

    expect(await readFile(join(result.dshHome, 'note.txt'), 'utf8')).toBe('hello')
    // node_modules must not be copied into the target.
    await expect(
      readFile(join(result.dshHome, 'profiles', 'node_modules', '@anthropic-ai', 'sdk'), 'utf8'),
    ).rejects.toThrow()
    expect(await readdir(join(result.dshHome))).toContain('note.txt')
  })

  it('preserves user-installed profile plugins (profiles/web/node_modules) during migration', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = await makeDir('home')
    const target = join(await makeDir('target'), 'LDD')
    await writeFile(join(oldDataRoot, 'settings.json'), '{}')
    // A real harness home has BOTH the top-level profiles/node_modules runtime
    // tree (symlinks, skipped) AND a per-profile node_modules holding plugins
    // the user installed through the plugin center (dshmarket) — the latter is
    // user data and must survive a data-directory move.
    const runtimeTree = join(oldDshHome, 'profiles', 'node_modules', '@anthropic-ai')
    await mkdir(runtimeTree, { recursive: true })
    await writeFile(join(runtimeTree, 'sdk'), 'runtime-link-target')
    const webProfile = join(oldDshHome, 'profiles', 'web', 'node_modules', 'dshmarket')
    await mkdir(webProfile, { recursive: true })
    await writeFile(join(webProfile, 'package.json'), '{"name":"dshmarket","version":"1.36.0"}')
    await writeFile(join(oldDshHome, 'profiles', 'web', 'package.json'), '{"dependencies":{"dshmarket":"^1.36.0"}}')

    const result = await migrateDataDirectory({ oldDataRoot, oldDshHome, newDataDirectory: target })

    // The runtime tree is skipped…
    await expect(
      readFile(join(result.dshHome, 'profiles', 'node_modules', '@anthropic-ai', 'sdk'), 'utf8'),
    ).rejects.toThrow()
    // …but the user's installed plugin survives.
    expect(
      await readFile(join(result.dshHome, 'profiles', 'web', 'node_modules', 'dshmarket', 'package.json'), 'utf8'),
    ).toContain('dshmarket')
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

  it('migrates only when the target harness dir is empty and legacy data exists', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = await makeDir('home')
    await writeFile(join(oldDshHome, 'note.txt'), 'hello')
    const target = join(await makeDir('target'), 'LDD')

    // Target harness dir is empty (and legacy has data) → migrates.
    expect(await migrateDataDirectoryIfNeeded({ oldDataRoot, oldDshHome, newDataDirectory: target })).toBe(true)
    expect(await readFile(join(target, 'harness', 'note.txt'), 'utf8')).toBe('hello')

    // Now the target harness dir is non-empty → no-op.
    expect(await migrateDataDirectoryIfNeeded({ oldDataRoot, oldDshHome, newDataDirectory: target })).toBe(false)
  })

  it('skips auto-migration when legacy data is absent', async () => {
    const oldDataRoot = await makeDir('data')
    const oldDshHome = join(await makeDir('missing'), 'harness') // never created
    const target = join(await makeDir('target'), 'LDD')

    expect(await migrateDataDirectoryIfNeeded({ oldDataRoot, oldDshHome, newDataDirectory: target })).toBe(false)
  })
})

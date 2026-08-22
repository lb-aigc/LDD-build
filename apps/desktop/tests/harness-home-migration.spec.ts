import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.js'
import {
  inspectMigration,
  migrateHarnessHome,
} from '../src/main/migration/harness-home.js'
import { createVersionBackup } from '../src/main/migration/backup.js'

describe('Harness home migration', () => {
  it('preserves old data and leaves the new home absent when compatibility fails', async () => {
    await using fixture = await createFixtureDirectory('ldd-migration-')
    const paths = migrationPaths(fixture.root)
    await writeFixture(paths.oldHome, 'sessions/a.jsonl', 'legacy')

    const result = await migrateHarnessHome(paths, async () => ({
      compatible: false,
      reason: 'format 0 rejected',
    }))

    expect(result.kind).toBe('incompatible')
    expect(await readFile(`${paths.oldHome}/sessions/a.jsonl`, 'utf8')).toBe('legacy')
    await expect(readFile(`${paths.newHome}/sessions/a.jsonl`, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses link-shaped source entries', async () => {
    await using fixture = await createFixtureDirectory('ldd-migration-')
    const paths = migrationPaths(fixture.root)
    await writeFixture(paths.oldHome, 'real.txt', 'secret')
    await symlink(`${paths.oldHome}/real.txt`, `${paths.oldHome}/linked.txt`)

    await expect(
      migrateHarnessHome(paths, async () => ({ compatible: true })),
    ).rejects.toThrow('link-shaped')
  })

  it('creates a verified version backup without modifying the source', async () => {
    await using fixture = await createFixtureDirectory('ldd-backup-')
    const paths = migrationPaths(fixture.root)
    await writeFixture(paths.newHome, 'sessions/a.jsonl', 'current')

    const backup = await createVersionBackup(paths.newHome, paths.backupsRoot, '0.1.1-rc.2')

    expect(await readFile(`${backup.path}/sessions/a.jsonl`, 'utf8')).toBe('current')
    expect(await readFile(`${paths.newHome}/sessions/a.jsonl`, 'utf8')).toBe('current')
  })
})

function migrationPaths(root: string) {
  return {
    oldHome: `${root}/old/.dsh`,
    newHome: `${root}/appdata/LDD/harness`,
    backupsRoot: `${root}/appdata/LDD/backups`,
  }
}

async function writeFixture(root: string, path: string, contents: string): Promise<void> {
  const target = `${root}/${path}`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

export { migrationPaths, writeFixture }

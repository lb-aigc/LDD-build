import assert from 'node:assert/strict'
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import { createVersionBackup } from '../src/main/migration/backup.ts'
import {
  inspectMigration,
  migrateHarnessHome,
  type MigrationPaths,
} from '../src/main/migration/harness-home.ts'

test('migration commits only a compatible verified copy', async () => {
  await using fixture = await createFixtureDirectory('ldd-migration-verify-')
  const paths = migrationPaths(fixture.root)
  await writeFixture(paths.oldHome, 'sessions/a.jsonl', 'legacy')
  assert.equal((await inspectMigration(paths.oldHome, paths.newHome)).kind, 'needs-confirmation')

  const incompatible = await migrateHarnessHome(paths, async (candidate) => {
    assert.equal(await readFile(join(candidate, 'sessions/a.jsonl'), 'utf8'), 'legacy')
    return { compatible: false, reason: 'format 0 rejected' }
  })
  assert.equal(incompatible.kind, 'incompatible')
  assert.equal(await readFile(join(paths.oldHome, 'sessions/a.jsonl'), 'utf8'), 'legacy')
  await assert.rejects(() => access(paths.newHome), { code: 'ENOENT' })

  const migrated = await migrateHarnessHome(paths, async () => ({ compatible: true }))
  assert.equal(migrated.kind, 'migrated')
  assert.equal(await readFile(join(paths.newHome, 'sessions/a.jsonl'), 'utf8'), 'legacy')
  assert.equal(await readFile(join(paths.oldHome, 'sessions/a.jsonl'), 'utf8'), 'legacy')
  assert.equal((await inspectMigration(paths.oldHome, paths.newHome)).kind, 'already-initialized')
})

test('migration rejects links and backup preserves the source', async () => {
  await using fixture = await createFixtureDirectory('ldd-migration-safety-')
  const paths = migrationPaths(fixture.root)
  await writeFixture(paths.oldHome, 'real.txt', 'secret')
  await symlink(join(paths.oldHome, 'real.txt'), join(paths.oldHome, 'linked.txt'))
  await assert.rejects(
    () => migrateHarnessHome(paths, async () => ({ compatible: true })),
    /link-shaped/,
  )
  await assert.rejects(() => access(paths.newHome), { code: 'ENOENT' })

  const cleanPaths = migrationPaths(join(fixture.root, 'clean'))
  await writeFixture(cleanPaths.newHome, 'sessions/a.jsonl', 'current')
  await writeFixture(cleanPaths.newHome, 'profiles/default/package.json', '{"private":true}\n')
  await mkdir(join(cleanPaths.newHome, 'profiles', 'node_modules'), { recursive: true })
  await symlink(
    join(cleanPaths.newHome, 'profiles', 'default'),
    join(cleanPaths.newHome, 'profiles', 'node_modules', 'runtime-link'),
    'dir',
  )
  const backup = await createVersionBackup(
    cleanPaths.newHome,
    cleanPaths.backupsRoot,
    '0.1.1-rc.2',
  )
  assert.equal(await readFile(join(backup.path, 'sessions/a.jsonl'), 'utf8'), 'current')
  await assert.rejects(() => access(join(backup.path, 'profiles', 'node_modules')), { code: 'ENOENT' })
  assert.equal(await readFile(join(cleanPaths.newHome, 'sessions/a.jsonl'), 'utf8'), 'current')
})

test('probe failure cleans only the candidate and preserves old data', async () => {
  await using fixture = await createFixtureDirectory('ldd-migration-probe-failure-')
  const paths = migrationPaths(fixture.root)
  await writeFixture(paths.oldHome, 'sessions/a.jsonl', 'legacy')

  await assert.rejects(
    () =>
      migrateHarnessHome(paths, async () => {
        throw new Error('probe crashed')
      }),
    /probe crashed/,
  )

  assert.equal(await readFile(join(paths.oldHome, 'sessions/a.jsonl'), 'utf8'), 'legacy')
  await assert.rejects(() => access(paths.newHome), { code: 'ENOENT' })
})

function migrationPaths(root: string): MigrationPaths {
  return {
    oldHome: join(root, 'old', '.dsh'),
    newHome: join(root, 'appdata', 'LDD', 'harness'),
    backupsRoot: join(root, 'appdata', 'LDD', 'backups'),
  }
}

async function writeFixture(root: string, path: string, contents: string): Promise<void> {
  const target = join(root, ...path.split('/'))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('source packaging preserves Git link identity as regular Windows files', async () => {
  const module = await import('../source-package-tree.mjs').catch(() => undefined)
  assert.ok(module, 'source packaging does not yet provide a Windows-compatible tree materializer')
  const { copyTrackedEntryWindowsCompatible } = module
  const root = await mkdtemp(join(tmpdir(), 'ldd-source-package-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  try {
    await mkdir(join(source, 'canonical', 'nested'), { recursive: true })
    await writeFile(join(source, 'canonical', 'AGENTS.md'), 'canonical file\n')
    await writeFile(join(source, 'canonical', 'nested', 'SKILL.md'), 'canonical directory\n')
    await symlink('canonical/AGENTS.md', join(source, 'CLAUDE.md'))
    await symlink('canonical/nested', join(source, 'skills'))

    await copyTrackedEntryWindowsCompatible(source, destination, 'CLAUDE.md', '120000')
    await copyTrackedEntryWindowsCompatible(source, destination, 'skills', '120000')

    assert.equal((await readFile(join(destination, 'CLAUDE.md'), 'utf8')), 'canonical/AGENTS.md')
    assert.equal((await readFile(join(destination, 'skills'), 'utf8')), 'canonical/nested')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source packaging understands Git link placeholders on Windows', async () => {
  const { copyTrackedEntryWindowsCompatible } = await import('../source-package-tree.mjs')
  const root = await mkdtemp(join(tmpdir(), 'ldd-source-package-windows-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  try {
    await mkdir(join(source, 'canonical'), { recursive: true })
    await writeFile(join(source, 'canonical', 'AGENTS.md'), 'checked out without symlink privileges\n')
    await writeFile(join(source, 'CLAUDE.md'), 'canonical/AGENTS.md')

    await copyTrackedEntryWindowsCompatible(source, destination, 'CLAUDE.md', '120000')

    assert.equal(
      await readFile(join(destination, 'CLAUDE.md'), 'utf8'),
      'canonical/AGENTS.md',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

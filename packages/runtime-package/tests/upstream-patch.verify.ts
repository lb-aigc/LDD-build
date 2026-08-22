import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { applyTrackedUpstreamPatches } from '../src/upstream-patches.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const officialCatalog = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'core',
  'session',
  'src',
  'known-event-types.ts',
)
const officialReleaseProcess = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'scripts',
  'release',
  'process.ts',
)
const patchRoot = join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.1-rc.2')

test('tracked Harness patches add LDD compatibility changes and apply exactly once', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-upstream-patch-'))
  try {
    const copiedRoot = join(parent, 'source')
    const copiedCatalog = join(
      copiedRoot,
      'packages',
      'core',
      'session',
      'src',
      'known-event-types.ts',
    )
    const copiedReleaseProcess = join(copiedRoot, 'scripts', 'release', 'process.ts')
    await mkdir(dirname(copiedCatalog), { recursive: true })
    await mkdir(dirname(copiedReleaseProcess), { recursive: true })
    await writeFile(copiedCatalog, await readFile(officialCatalog))
    await writeFile(copiedReleaseProcess, await readFile(officialReleaseProcess))

    const applied = await applyTrackedUpstreamPatches(copiedRoot, patchRoot)
    const result = await readFile(copiedCatalog, 'utf8')
    assert.match(result, /'video\/analysis-input'/)
    const releaseModule = await import(pathToFileURL(copiedReleaseProcess).href) as Record<string, unknown>
    const candidate = releaseModule.resolveSpawnInvocation
    assert.equal(typeof candidate, 'function')
    const resolveSpawnInvocation = candidate as (
      command: string,
      args: readonly string[],
      platform: NodeJS.Platform,
      environment: Readonly<NodeJS.ProcessEnv>,
    ) => { readonly command: string; readonly args: readonly string[] }
    assert.deepEqual(resolveSpawnInvocation('pnpm', ['--version'], 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }), {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', '--version'],
    })
    assert.deepEqual(applied.map((entry) => entry.path), [
      '0001-register-video-analysis-input-session-event.patch',
      '0002-launch-package-manager-shims-on-windows.patch',
    ])
    await assert.rejects(
      applyTrackedUpstreamPatches(copiedRoot, patchRoot),
      /does not match the official source/,
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

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
const patchRoot = join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.1-rc.2')

test('tracked Harness patch makes video analysis input durable and applies exactly once', async () => {
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
    await mkdir(dirname(copiedCatalog), { recursive: true })
    await writeFile(copiedCatalog, await readFile(officialCatalog))

    const applied = await applyTrackedUpstreamPatches(copiedRoot, patchRoot)
    const result = await readFile(copiedCatalog, 'utf8')
    assert.match(result, /'video\/analysis-input'/)
    assert.deepEqual(applied.map((entry) => entry.path), [
      '0001-register-video-analysis-input-session-event.patch',
    ])
    await assert.rejects(
      applyTrackedUpstreamPatches(copiedRoot, patchRoot),
      /does not match the official source/,
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

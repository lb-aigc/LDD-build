import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { makeManifest, writeRuntimeMetadata } from '../src/manifest.ts'
import { packRuntime } from '../src/pack.ts'

const manifestOptions = {
  harnessVersion: '0.1.1-rc.2',
  createdAt: '2026-08-22T00:00:00.000Z',
  minimumLddVersion: '0.2.0',
  sourceArchiveSha256: 'a'.repeat(64),
  npmIntegrity: null,
  plugins: [],
} as const

test('runtime manifests and archives are sorted, complete, and deterministic', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-runtime-verify-'))
  try {
    const root = join(parent, 'runtime')
    await mkdir(join(root, 'z'), { recursive: true })
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'z', 'last.txt'), 'last\n')
    await writeFile(join(root, 'a', 'first.txt'), 'first\n')
    const manifest = await makeManifest(root, manifestOptions)
    assert.deepEqual(manifest.files.map((file) => file.path), ['a/first.txt', 'z/last.txt'])

    await writeRuntimeMetadata(root, manifestOptions)
    const first = join(parent, 'first.lddruntime')
    const second = join(parent, 'second.lddruntime')
    const firstResult = await packRuntime(root, first)
    const secondResult = await packRuntime(root, second)
    const [firstBytes, secondBytes] = await Promise.all([readFile(first), readFile(second)])
    assert.deepEqual(firstBytes, secondBytes)
    assert.equal(firstResult.sha256, createHash('sha256').update(firstBytes).digest('hex'))
    assert.deepEqual(firstResult.entries, secondResult.entries)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

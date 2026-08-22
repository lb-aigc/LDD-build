import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { writeRuntimeMetadata } from '../src/manifest.ts'
import { packRuntime } from '../src/pack.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; out: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-runtime-pack-'))
  roots.push(parent)
  const root = join(parent, 'runtime')
  await mkdir(join(root, 'nested'), { recursive: true })
  await writeFile(join(root, 'nested', 'entry.js'), 'export const version = 1\n')
  await writeRuntimeMetadata(root, {
    harnessVersion: '0.1.1-rc.2',
    createdAt: '2026-08-22T00:00:00.000Z',
    minimumLddVersion: '0.2.0',
    sourceArchiveSha256: 'a'.repeat(64),
    npmIntegrity: null,
    plugins: [],
  })
  return { root, out: join(parent, 'runtime.lddruntime') }
}

describe('packRuntime', () => {
  it('emits the same deterministic ZIP bytes on repeated packaging', async () => {
    const { root, out } = await fixture()
    const second = `${out}.second`
    const firstResult = await packRuntime(root, out)
    const secondResult = await packRuntime(root, second)
    const [firstBytes, secondBytes] = await Promise.all([readFile(out), readFile(second)])

    expect(firstBytes.subarray(0, 4).toString('hex')).toBe('504b0304')
    expect(createHash('sha256').update(firstBytes).digest('hex')).toBe(firstResult.sha256)
    expect(firstBytes).toEqual(secondBytes)
    expect(secondResult.entries).toEqual([
      'checksums.sha256',
      'nested/entry.js',
      'runtime.json',
    ])
  })

  it('refuses to pack a payload changed after its metadata was written', async () => {
    const { root, out } = await fixture()
    await writeFile(join(root, 'nested', 'entry.js'), 'tampered\n')

    await expect(packRuntime(root, out)).rejects.toThrow(/manifest verification failed/i)
  })
})

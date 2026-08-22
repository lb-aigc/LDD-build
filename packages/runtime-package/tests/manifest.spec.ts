import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { makeManifest, writeRuntimeMetadata } from '../src/manifest.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureRuntime(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ldd-runtime-manifest-'))
  roots.push(root)
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(join(root, 'bin', 'dsh.js'), 'console.log("dsh")\n')
  await writeFile(join(root, 'package.json'), '{"private":true}\n')
  return root
}

function options(createdAt: string) {
  return {
    harnessVersion: '0.1.1-rc.2',
    createdAt,
    minimumLddVersion: '0.2.0',
    sourceArchiveSha256: 'a'.repeat(64),
    npmIntegrity: null,
    plugins: [{
      name: '@ldd/dsh-video-frame-analyzer',
      version: '0.2.0',
      sha256: 'b'.repeat(64),
    }],
  } as const
}

describe('runtime manifest', () => {
  it('sorts paths and excludes build timestamps from file identity', async () => {
    const root = await fixtureRuntime()
    const first = await makeManifest(root, options('2026-08-22T00:00:00.000Z'))
    const second = await makeManifest(root, options('2026-08-23T00:00:00.000Z'))

    expect(first.files.map((file) => file.path)).toEqual(['bin/dsh.js', 'package.json'])
    expect(first.files).toEqual(second.files)
    expect(first.createdAt).not.toBe(second.createdAt)
  })

  it('writes runtime.json and a complete checksum list without self-reference', async () => {
    const root = await fixtureRuntime()
    const manifest = await writeRuntimeMetadata(root, options('2026-08-22T00:00:00.000Z'))

    expect(manifest.files.map((file) => file.path)).not.toContain('runtime.json')
    const checksums = await import('node:fs/promises').then(({ readFile }) =>
      readFile(join(root, 'checksums.sha256'), 'utf8'),
    )
    expect(checksums).toMatch(/[a-f0-9]{64} \*runtime\.json\n/)
    expect(checksums).toMatch(/[a-f0-9]{64} \*bin\/dsh\.js\n/)
    expect(checksums).not.toContain('checksums.sha256')
  })
})

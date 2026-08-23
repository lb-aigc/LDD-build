import { createHash } from 'node:crypto'
import { access, mkdir, open } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { packRuntime, writeRuntimeMetadata } from '@ldd/runtime-package'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.js'
import {
  extractRuntimeArchive,
  validateRuntimeArchivePath,
} from '../src/main/runtime/archive.js'
import { runtimeArchiveLimits } from '../src/main/runtime/limits.js'
import { writeStoredZip } from './runtime-archive-fixture.js'

const limits = {
  maxEntries: 20,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxCompressedBytes: 4 * 1024 * 1024,
}

describe('runtime archive paths', () => {
  it.each([
    '../escape.txt',
    '/absolute.txt',
    'C:/windows/system32/file',
    'safe/../../escape.txt',
    'safe\\escape.txt',
    'plugins/NUL.txt',
    'package.json ',
    'plugins/bad<name>.tgz',
    'plugins/NUL .txt',
  ])('rejects unsafe archive entry %s', (entry) => {
    expect(() => validateRuntimeArchivePath(entry)).toThrow('unsafe runtime path')
  })

  it('normalizes a safe runtime path without changing its identity', () => {
    expect(validateRuntimeArchivePath('node_modules/pkg/index.js')).toBe(
      'node_modules/pkg/index.js',
    )
  })

  it('extracts only files covered by the manifest and checksum list', async () => {
    await using fixture = await createFixtureDirectory('ldd-runtime-archive-')
    const payload = Buffer.from('abc')
    const payloadSha256 = sha256(payload)
    const manifest = Buffer.from(
      `${JSON.stringify(
        {
          formatVersion: 1,
          harnessVersion: '0.1.1-rc.2',
          platform: 'win32',
          arch: 'x64',
          nodeMajor: 24,
          createdAt: '2026-08-22T10:00:00.000Z',
          minimumLddVersion: '0.2.0',
          sourceArchiveSha256:
            '47fb7e386c0bd86a6c4341321b8f2915cd6f490a687f8deaf78714e369e4c91d',
          npmIntegrity: null,
          plugins: [],
          files: [{ path: 'package.json', size: payload.length, sha256: payloadSha256 }],
        },
        null,
        2,
      )}\n`,
    )
    const checksums = Buffer.from(
      `${sha256(manifest)}  runtime.json\n${payloadSha256}  package.json\n`,
    )
    const archive = fixture.path('valid.lddruntime')
    await writeStoredZip(archive, [
      { path: 'runtime.json', bytes: manifest },
      { path: 'checksums.sha256', bytes: checksums },
      { path: 'package.json', bytes: payload },
    ])

    const result = await extractRuntimeArchive(archive, fixture.path('staging', 'valid'), limits)

    expect(result.manifest.harnessVersion).toBe('0.1.1-rc.2')
    expect(result.signatureStatus).toBe('absent')
    expect(result.files.get('package.json')?.sha256).toBe(payloadSha256)
  })

  it('removes its staging directory after rejecting path traversal', async () => {
    await using fixture = await createFixtureDirectory('ldd-runtime-archive-')
    const archive = fixture.path('unsafe.lddruntime')
    const staging = fixture.path('staging', 'unsafe')
    await writeStoredZip(archive, [{ path: '../escape.txt', bytes: Buffer.from('x') }])

    await expect(extractRuntimeArchive(archive, staging, limits)).rejects.toThrow()
    await expect(access(staging)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('packs and extracts a runtime executable above the legacy 128 MiB limit', async () => {
    await using fixture = await createFixtureDirectory('ldd-runtime-large-file-')
    const runtimeRoot = fixture.path('runtime')
    const executablePath = 'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe'
    const executableBytes = 129 * 1024 * 1024
    const executable = fixture.path('runtime', ...executablePath.split('/'))
    await mkdir(fixture.path('runtime', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64'), {
      recursive: true,
    })
    const file = await open(executable, 'w')
    try {
      await file.truncate(executableBytes)
    } finally {
      await file.close()
    }
    await writeRuntimeMetadata(runtimeRoot, {
      harnessVersion: '0.1.1-rc.2',
      createdAt: '2026-08-24T00:00:00.000Z',
      minimumLddVersion: '0.2.0',
      sourceArchiveSha256: 'a'.repeat(64),
      npmIntegrity: null,
      plugins: [],
    })
    const archive = fixture.path('runtime.lddruntime')
    await packRuntime(runtimeRoot, archive)

    const result = await extractRuntimeArchive(
      archive,
      fixture.path('staging', 'large-file'),
      runtimeArchiveLimits,
    )

    expect(result.files.get(executablePath)?.size).toBe(executableBytes)
  }, 30_000)
})

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

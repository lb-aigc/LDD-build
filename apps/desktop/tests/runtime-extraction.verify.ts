import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { Readable } from 'node:stream'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import {
  extractRuntimeArchive,
  type RuntimeArchiveEntry,
  type RuntimeArchiveOpener,
  type RuntimeZipFile,
} from '../src/main/runtime/archive.ts'

const limits = {
  maxEntries: 20,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxCompressedBytes: 4 * 1024 * 1024,
}

test('verified extraction accepts a fully covered runtime and rejects traversal', async () => {
  await using fixture = await createFixtureDirectory('ldd-runtime-extraction-')
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
  const opener = memoryArchive([
    ['runtime.json', manifest],
    ['checksums.sha256', checksums],
    ['package.json', payload],
  ])

  const result = await extractRuntimeArchive(
    fixture.path('unused.lddruntime'),
    fixture.path('staging', 'valid'),
    limits,
    opener,
  )
  assert.equal(result.manifest.harnessVersion, '0.1.1-rc.2')
  assert.equal(result.signatureStatus, 'absent')
  assert.equal(result.files.get('package.json')?.sha256, payloadSha256)

  const unsafeStaging = fixture.path('staging', 'unsafe')
  await assert.rejects(
    () =>
      extractRuntimeArchive(
        fixture.path('unused-unsafe.lddruntime'),
        unsafeStaging,
        limits,
        memoryArchive([['../escape.txt', Buffer.from('x')]]),
      ),
    /unsafe runtime path/,
  )
  await assert.rejects(() => access(unsafeStaging), { code: 'ENOENT' })
})

function memoryArchive(
  files: readonly (readonly [path: string, bytes: Buffer])[],
): RuntimeArchiveOpener {
  return async () => new MemoryZip(files)
}

class MemoryZip extends EventEmitter implements RuntimeZipFile {
  readonly #entries: Array<{ entry: RuntimeArchiveEntry; bytes: Buffer }>
  #index = 0

  constructor(files: readonly (readonly [path: string, bytes: Buffer])[]) {
    super()
    this.#entries = files.map(([path, bytes]) => ({
      entry: {
        fileName: path,
        compressedSize: bytes.length,
        uncompressedSize: bytes.length,
        externalFileAttributes: 0o100644 << 16,
        generalPurposeBitFlag: 0,
      },
      bytes,
    }))
  }

  readEntry(): void {
    queueMicrotask(() => {
      const next = this.#entries[this.#index]
      this.#index += 1
      if (next === undefined) {
        this.emit('end')
      } else {
        this.emit('entry', next.entry)
      }
    })
  }

  close(): void {}

  openReadStream(
    entry: RuntimeArchiveEntry,
    callback: (error: Error | null, stream?: Readable) => void,
  ): void {
    const match = this.#entries.find((candidate) => candidate.entry === entry)
    queueMicrotask(() => {
      if (match === undefined) {
        callback(new Error('missing in-memory archive entry'))
      } else {
        callback(null, Readable.from(match.bytes))
      }
    })
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

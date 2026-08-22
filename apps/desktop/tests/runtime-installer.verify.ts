import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import { RuntimeInstaller, type InstalledRuntime } from '../src/main/runtime/installer.ts'
import type {
  RuntimeArchiveEntry,
  RuntimeArchiveOpener,
  RuntimeZipFile,
} from '../src/main/runtime/archive.ts'
import { RuntimeTransaction } from '../src/main/runtime/transaction.ts'
import {
  createDefaultRuntimeState,
  readRuntimeState,
  writeRuntimeState,
} from '../src/main/runtime/state.ts'

const candidate: InstalledRuntime = {
  version: '0.1.1-rc.2',
  path: 'versions/0.1.1-rc.2',
  manifest: {
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
    files: [{ path: 'package.json', size: 3, sha256: '2'.repeat(64) }],
  },
}

test('activation rolls back exact state or commits only after observation', async () => {
  await using fixture = await createFixtureDirectory('ldd-installer-verify-')
  const statePath = fixture.path('runtime', 'state.json')
  const before = {
    ...createDefaultRuntimeState(),
    activeVersion: '0.1.1-rc.1',
    lastKnownGoodVersion: '0.1.1-rc.1',
  }
  await writeRuntimeState(statePath, before)
  const events: string[] = []
  const installer = new RuntimeInstaller({
    statePath,
    stagingRoot: fixture.path('runtime', 'staging'),
    versionsRoot: fixture.path('runtime', 'versions'),
    resolveInstalledRuntime: async (version) => (version === candidate.version ? candidate : null),
    lifecycle: {
      stopCurrent: async () => {
        events.push('stop-current')
      },
      startCandidate: async () => ({
        stop: async () => {
          events.push('stop-candidate')
        },
      }),
      restorePrevious: async () => {
        events.push('restore-previous')
      },
    },
  })

  await assert.rejects(
    () => installer.activate(candidate.version, async () => Promise.reject(new Error('candidate failed'))),
    /candidate failed/,
  )
  assert.deepEqual((await readRuntimeState(statePath)).state, before)
  assert.deepEqual(events, ['stop-current', 'stop-candidate', 'restore-previous'])

  await installer.activate(candidate.version, async () => undefined)
  assert.deepEqual((await readRuntimeState(statePath)).state, {
    ...before,
    activeVersion: candidate.version,
    lastKnownGoodVersion: before.activeVersion,
    pendingVersion: null,
  })
})

test('first external activation keeps the packaged fallback as the implicit rollback target', async () => {
  await using fixture = await createFixtureDirectory('ldd-installer-first-activation-')
  const statePath = fixture.path('runtime', 'state.json')
  await writeRuntimeState(statePath, createDefaultRuntimeState())
  const installer = new RuntimeInstaller({
    statePath,
    stagingRoot: fixture.path('runtime', 'staging'),
    versionsRoot: fixture.path('runtime', 'versions'),
    resolveInstalledRuntime: async () => candidate,
    lifecycle: {
      stopCurrent: async () => undefined,
      startCandidate: async () => ({ stop: async () => undefined }),
      restorePrevious: async () => undefined,
    },
  })
  await installer.activate(candidate.version, async () => undefined)
  assert.deepEqual((await readRuntimeState(statePath)).state, {
    ...createDefaultRuntimeState(),
    activeVersion: candidate.version,
    lastKnownGoodVersion: null,
    pendingVersion: null,
  })
})

test('installation moves a verified candidate without changing runtime state', async () => {
  await using fixture = await createFixtureDirectory('ldd-installer-install-')
  const statePath = fixture.path('runtime', 'state.json')
  const before = {
    ...createDefaultRuntimeState(),
    activeVersion: '0.1.1-rc.1',
    lastKnownGoodVersion: '0.1.1-rc.1',
  }
  await writeRuntimeState(statePath, before)
  const payload = Buffer.from('abc')
  const payloadSha256 = sha256(payload)
  const manifest = Buffer.from(
    `${JSON.stringify(
      {
        ...candidate.manifest,
        files: [{ path: 'package.json', size: payload.length, sha256: payloadSha256 }],
      },
      null,
      2,
    )}\n`,
  )
  const checksums = Buffer.from(
    `${sha256(manifest)}  runtime.json\n${payloadSha256}  package.json\n`,
  )
  const stagingRoot = fixture.path('runtime', 'staging')
  const installer = new RuntimeInstaller({
    statePath,
    stagingRoot,
    versionsRoot: fixture.path('runtime', 'versions'),
    lifecycle: {
      stopCurrent: async () => undefined,
      startCandidate: async () => ({ stop: async () => undefined }),
      restorePrevious: async () => undefined,
    },
  })

  const installed = await installer.install(
    {
      archivePath: fixture.path('unused.lddruntime'),
      limits: {
        maxEntries: 20,
        maxFileBytes: 1024 * 1024,
        maxTotalBytes: 4 * 1024 * 1024,
        maxCompressedBytes: 4 * 1024 * 1024,
      },
      openArchive: memoryArchive([
        ['runtime.json', manifest],
        ['checksums.sha256', checksums],
        ['package.json', payload],
      ]),
    },
    async () => undefined,
  )

  assert.equal(installed.version, candidate.version)
  assert.equal(await readFile(fixture.path('runtime', 'versions', candidate.version, 'package.json'), 'utf8'), 'abc')
  assert.deepEqual((await readRuntimeState(statePath)).state, before)
  assert.deepEqual(await readdir(stagingRoot), [])
})

test('transaction cleanup removes only its marker-owned directory', async () => {
  await using fixture = await createFixtureDirectory('ldd-transaction-cleanup-')
  const stagingRoot = fixture.path('runtime', 'staging')
  const sentinel = fixture.path('keep.txt')
  await writeFile(sentinel, 'keep')
  const transaction = await RuntimeTransaction.create(stagingRoot)
  const ownedPath = transaction.path
  await transaction.transition('failed')

  await transaction.cleanup()

  await assert.rejects(() => access(ownedPath), { code: 'ENOENT' })
  assert.equal(await readFile(sentinel, 'utf8'), 'keep')
})

test('a failed pre-activation backup leaves state and process lifecycle untouched', async () => {
  await using fixture = await createFixtureDirectory('ldd-installer-backup-failure-')
  const statePath = fixture.path('runtime', 'state.json')
  const before = {
    ...createDefaultRuntimeState(),
    activeVersion: '0.1.1-rc.1',
    lastKnownGoodVersion: '0.1.1-rc.1',
  }
  await writeRuntimeState(statePath, before)
  const events: string[] = []
  const installer = new RuntimeInstaller({
    statePath,
    stagingRoot: fixture.path('runtime', 'staging'),
    versionsRoot: fixture.path('runtime', 'versions'),
    resolveInstalledRuntime: async () => candidate,
    beforeActivate: async () => {
      throw new Error('backup failed')
    },
    lifecycle: {
      stopCurrent: async () => {
        events.push('stop')
      },
      startCandidate: async () => ({ stop: async () => undefined }),
      restorePrevious: async () => {
        events.push('restore')
      },
    },
  })

  await assert.rejects(
    () => installer.activate(candidate.version, async () => undefined),
    /backup failed/,
  )
  assert.deepEqual((await readRuntimeState(statePath)).state, before)
  assert.deepEqual(events, [])
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
    const match = this.#entries.find((candidateEntry) => candidateEntry.entry === entry)
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

import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  unlink,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve, sep } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseRuntimeManifest, type RuntimeManifest } from './manifest.ts'
import { runtimePathIdentity, validateRuntimePath } from './runtime-path.ts'

export { validateRuntimePath as validateRuntimeArchivePath } from './runtime-path.ts'

const runtimeManifestPath = 'runtime.json'
const checksumListPath = 'checksums.sha256'
const unixFileTypeMask = 0o170000
const unixRegularFile = 0o100000
const unixDirectory = 0o040000
const unixSymbolicLink = 0o120000
const windowsReparsePoint = 0x0400

export interface RuntimeArchiveLimits {
  readonly maxEntries: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxCompressedBytes: number
}

export interface VerifiedRuntimeFile {
  readonly path: string
  readonly absolutePath: string
  readonly size: number
  readonly sha256: string
}

export interface VerifiedExtraction {
  readonly stagingPath: string
  readonly manifest: RuntimeManifest
  readonly files: ReadonlyMap<string, VerifiedRuntimeFile>
  readonly signatureStatus: 'absent' | 'unverified'
}

export interface RuntimeArchiveEntry {
  readonly fileName: string
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly externalFileAttributes: number
  readonly generalPurposeBitFlag: number
}

export interface RuntimeZipFile {
  readEntry(): void
  close(): void
  on(event: 'entry', listener: (entry: RuntimeArchiveEntry) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
  openReadStream(
    entry: RuntimeArchiveEntry,
    callback: (error: Error | null, stream?: Readable) => void,
  ): void
}

interface YauzlLike {
  open(
    archivePath: string,
    options: {
      readonly autoClose: false
      readonly decodeStrings: true
      readonly lazyEntries: true
      readonly strictFileNames: true
      readonly validateEntrySizes: true
    },
    callback: (error: Error | null, zipFile?: RuntimeZipFile) => void,
  ): void
}

interface ExtractionCounters {
  entries: number
  compressedBytes: number
  uncompressedBytes: number
}

export type RuntimeArchiveOpener = (archivePath: string) => Promise<RuntimeZipFile>

export async function extractRuntimeArchive(
  archivePath: string,
  stagingPath: string,
  limits: RuntimeArchiveLimits,
  openArchive: RuntimeArchiveOpener = openDefaultArchive,
): Promise<VerifiedExtraction> {
  validateLimits(limits)
  await mkdir(dirname(stagingPath), { mode: 0o700, recursive: true })
  await mkdir(stagingPath, { mode: 0o700, recursive: false })

  const extracted = new Map<string, VerifiedRuntimeFile>()
  const identities = new Set<string>()
  const counters: ExtractionCounters = {
    entries: 0,
    compressedBytes: 0,
    uncompressedBytes: 0,
  }

  try {
    const zipFile = await openArchive(archivePath)
    try {
      await consumeEntries(zipFile, async (entry) => {
        await extractEntry(entry, zipFile, stagingPath, limits, counters, identities, extracted)
      })
    } finally {
      zipFile.close()
    }
    return await verifyExtraction(stagingPath, extracted)
  } catch (error) {
    await rm(stagingPath, { force: true, recursive: true })
    throw error
  }
}

async function extractEntry(
  entry: RuntimeArchiveEntry,
  zipFile: RuntimeZipFile,
  stagingPath: string,
  limits: RuntimeArchiveLimits,
  counters: ExtractionCounters,
  identities: Set<string>,
  extracted: Map<string, VerifiedRuntimeFile>,
): Promise<void> {
  counters.entries += 1
  counters.compressedBytes += entry.compressedSize
  counters.uncompressedBytes += entry.uncompressedSize
  if (
    counters.entries > limits.maxEntries ||
    counters.compressedBytes > limits.maxCompressedBytes ||
    counters.uncompressedBytes > limits.maxTotalBytes ||
    entry.uncompressedSize > limits.maxFileBytes
  ) {
    throw new Error(`runtime archive exceeds extraction limits at ${entry.fileName}`)
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error(`encrypted runtime entry is not allowed: ${entry.fileName}`)
  }
  rejectLinkShapedEntry(entry)

  const isDirectory = entry.fileName.endsWith('/')
  const rawPath = isDirectory ? entry.fileName.slice(0, -1) : entry.fileName
  const runtimePath = validateRuntimePath(rawPath)
  const identity = runtimePathIdentity(runtimePath)
  if (identities.has(identity)) {
    throw new Error(`duplicate normalized runtime path: ${runtimePath}`)
  }
  identities.add(identity)

  const destination = resolveStagingPath(stagingPath, runtimePath)
  if (isDirectory) {
    await mkdir(destination, { mode: 0o700, recursive: true })
    return
  }

  await mkdir(dirname(destination), { mode: 0o700, recursive: true })
  const file = await writeEntryFile(zipFile, entry, destination, runtimePath, limits.maxFileBytes)
  extracted.set(identity, file)
}

async function writeEntryFile(
  zipFile: RuntimeZipFile,
  entry: RuntimeArchiveEntry,
  destination: string,
  runtimePath: string,
  maxFileBytes: number,
): Promise<VerifiedRuntimeFile> {
  const input = await openEntryStream(zipFile, entry)
  const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY
  const noFollowFlags =
    typeof fsConstants.O_NOFOLLOW === 'number' ? flags | fsConstants.O_NOFOLLOW : flags
  const output = await open(destination, noFollowFlags, 0o600)
  const hash = createHash('sha256')
  let size = 0
  let writePosition = 0
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > maxFileBytes || size > entry.uncompressedSize) {
        callback(new Error(`runtime entry expanded beyond declared size: ${runtimePath}`))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const writer = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      void writeCompleteBuffer(output, chunk, writePosition).then(
        (bytesWritten) => {
          writePosition += bytesWritten
          callback()
        },
        callback,
      )
    },
  })

  try {
    await pipeline(input, verifier, writer)
    if (size !== entry.uncompressedSize) {
      throw new Error(`runtime entry size mismatch: ${runtimePath}`)
    }
    await output.sync()
  } catch (error) {
    await output.close().catch(() => undefined)
    await unlink(destination).catch(() => undefined)
    throw error
  }
  await output.close()
  return {
    path: runtimePath,
    absolutePath: destination,
    size,
    sha256: hash.digest('hex'),
  }
}

async function writeCompleteBuffer(
  output: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  position: number,
): Promise<number> {
  let offset = 0
  while (offset < buffer.length) {
    const result = await output.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    )
    if (result.bytesWritten === 0) {
      throw new Error('runtime archive write made no progress')
    }
    offset += result.bytesWritten
  }
  return offset
}

async function verifyExtraction(
  stagingPath: string,
  extracted: ReadonlyMap<string, VerifiedRuntimeFile>,
): Promise<VerifiedExtraction> {
  const manifestFile = requireExtracted(extracted, runtimeManifestPath)
  const checksumFile = requireExtracted(extracted, checksumListPath)
  const manifest = parseRuntimeManifest(
    JSON.parse(await readFile(manifestFile.absolutePath, 'utf8')) as unknown,
  )
  const checksums = parseChecksumList(await readFile(checksumFile.absolutePath, 'utf8'))
  const expectedIdentities = new Set([
    runtimePathIdentity(runtimeManifestPath),
    runtimePathIdentity(checksumListPath),
  ])

  const manifestChecksum = checksums.get(runtimePathIdentity(runtimeManifestPath))
  if (manifestChecksum !== manifestFile.sha256) {
    throw new Error('runtime.json checksum mismatch')
  }

  for (const expected of manifest.files) {
    const identity = runtimePathIdentity(expected.path)
    expectedIdentities.add(identity)
    const actual = extracted.get(identity)
    if (actual === undefined) {
      throw new Error(`runtime manifest file is missing: ${expected.path}`)
    }
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`runtime manifest verification failed: ${expected.path}`)
    }
    if (checksums.get(identity) !== expected.sha256) {
      throw new Error(`checksums.sha256 mismatch: ${expected.path}`)
    }
  }

  for (const actual of extracted.values()) {
    if (!expectedIdentities.has(runtimePathIdentity(actual.path))) {
      throw new Error(`runtime archive contains unlisted file: ${actual.path}`)
    }
  }
  for (const checksumIdentity of checksums.keys()) {
    if (!expectedIdentities.has(checksumIdentity)) {
      throw new Error(`checksums.sha256 contains an unlisted path: ${checksumIdentity}`)
    }
  }

  return {
    stagingPath,
    manifest,
    files: new Map(extracted),
    signatureStatus: manifest.signature === undefined ? 'absent' : 'unverified',
  }
}

function parseChecksumList(serialized: string): Map<string, string> {
  const checksums = new Map<string, string>()
  const lines = serialized.split(/\r?\n/).filter((line) => line.length > 0)
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line)
    if (match === null) {
      throw new Error('checksums.sha256 contains an invalid line')
    }
    const digest = match[1]
    const path = match[2]
    if (digest === undefined || path === undefined) {
      throw new Error('checksums.sha256 contains an invalid line')
    }
    const identity = runtimePathIdentity(path)
    if (checksums.has(identity)) {
      throw new Error(`checksums.sha256 contains a duplicate path: ${path}`)
    }
    checksums.set(identity, digest)
  }
  return checksums
}

function requireExtracted(
  extracted: ReadonlyMap<string, VerifiedRuntimeFile>,
  runtimePath: string,
): VerifiedRuntimeFile {
  const file = extracted.get(runtimePathIdentity(runtimePath))
  if (file === undefined) {
    throw new Error(`runtime archive is missing ${runtimePath}`)
  }
  return file
}

function rejectLinkShapedEntry(entry: RuntimeArchiveEntry): void {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixType = unixMode & unixFileTypeMask
  if (
    unixType === unixSymbolicLink ||
    (unixType !== 0 && unixType !== unixRegularFile && unixType !== unixDirectory) ||
    (entry.externalFileAttributes & windowsReparsePoint) !== 0
  ) {
    throw new Error(`link-shaped runtime entry is not allowed: ${entry.fileName}`)
  }
}

function resolveStagingPath(stagingPath: string, runtimePath: string): string {
  const root = resolve(stagingPath)
  const destination = resolve(root, ...runtimePath.split('/'))
  if (!destination.startsWith(`${root}${sep}`)) {
    throw new Error(`unsafe runtime path: ${runtimePath}`)
  }
  return destination
}

async function openEntryStream(
  zipFile: RuntimeZipFile,
  entry: RuntimeArchiveEntry,
): Promise<Readable> {
  return await new Promise((resolveStream, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null) {
        reject(error)
      } else if (stream === undefined) {
        reject(new Error(`runtime entry stream is unavailable: ${entry.fileName}`))
      } else {
        resolveStream(stream)
      }
    })
  })
}

async function openDefaultArchive(archivePath: string): Promise<RuntimeZipFile> {
  await assertRegularArchive(archivePath)
  const yauzl = await loadYauzl()
  return await new Promise((resolveZip, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error !== null) {
          reject(error)
        } else if (zipFile === undefined) {
          reject(new Error('runtime archive could not be opened'))
        } else {
          resolveZip(zipFile)
        }
      },
    )
  })
}

async function loadYauzl(): Promise<YauzlLike> {
  const loaded = (await import('yauzl')) as unknown as {
    readonly default?: YauzlLike
    readonly open?: YauzlLike['open']
  }
  if (typeof loaded.open === 'function') {
    return { open: loaded.open }
  }
  if (typeof loaded.default?.open === 'function') {
    return loaded.default
  }
  throw new Error('yauzl runtime archive reader is unavailable')
}

async function consumeEntries(
  zipFile: RuntimeZipFile,
  consume: (entry: RuntimeArchiveEntry) => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolveEntries, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    zipFile.on('error', fail)
    zipFile.on('end', () => {
      if (!settled) {
        settled = true
        resolveEntries()
      }
    })
    zipFile.on('entry', (entry) => {
      void consume(entry).then(
        () => {
          if (!settled) {
            zipFile.readEntry()
          }
        },
        fail,
      )
    })
    zipFile.readEntry()
  })
}

async function assertRegularArchive(archivePath: string): Promise<void> {
  const metadata = await lstat(archivePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('runtime archive must be a regular file')
  }
}

function validateLimits(limits: RuntimeArchiveLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`)
    }
  }
}

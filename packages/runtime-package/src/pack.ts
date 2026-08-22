import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants, createReadStream } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { compareRuntimeNames, parseRuntimeManifest } from '@ldd/runtime-kit/runtime-manifest'

import {
  isRuntimePathInside,
  verifyRuntimeMetadata,
  type RuntimeManifest,
} from './manifest.ts'

const localFileHeaderSignature = 0x04034b50
const centralDirectoryHeaderSignature = 0x02014b50
const endOfCentralDirectorySignature = 0x06054b50
const utf8Flag = 0x0800
const zipVersion = 20
const unixZipVersion = (3 << 8) | zipVersion
const fixedDosTime = 0
const fixedDosDate = (20 << 9) | (1 << 5) | 1
const storedMethod = 0
const deflatedMethod = 8
const regularFileAttributes = (0o100644 << 16) >>> 0
const maxZip32 = 0xffff_ffff
const maxZipEntries = 0xffff
const maxInputFileBytes = 128 * 1024 * 1024
const maxCompressedInputBytes = 16 * 1024 * 1024

export interface PackedRuntimeResult {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly entries: readonly string[]
  readonly manifest: RuntimeManifest
}

interface CentralEntry {
  readonly name: Buffer
  readonly method: number
  readonly crc32: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localOffset: number
}

export async function packRuntime(
  runtimeRoot: string,
  outputFile: string,
): Promise<PackedRuntimeResult> {
  if (!isAbsolute(runtimeRoot) || !isAbsolute(outputFile)) {
    throw new TypeError('runtime root and output file must be absolute')
  }
  const root = resolve(runtimeRoot)
  const output = resolve(outputFile)
  if (isRuntimePathInside(root, output)) {
    throw new Error('runtime archive output must be outside the runtime root')
  }
  const verified = await verifyRuntimeMetadata(root)
  const runtimeJson = await readStableEntry(root, 'runtime.json')
  const manifest = parseRuntimeManifest(JSON.parse(runtimeJson.toString('utf8')) as unknown)
  if (JSON.stringify(manifest) !== JSON.stringify(verified)) {
    throw new Error('runtime manifest changed while preparing the archive')
  }
  const entries = [
    'checksums.sha256',
    ...manifest.files.map((file) => file.path),
    'runtime.json',
  ].sort(compareRuntimeNames)
  if (entries.length > maxZipEntries) throw new Error('runtime archive exceeds the ZIP32 entry limit')
  await mkdir(dirname(output), { mode: 0o700, recursive: true })
  await assertMissingOutput(output)
  const snapshotRoot = await mkdtemp(join(dirname(output), '.ldd-pack-snapshot-'))
  try {
    await createArchiveSnapshot(root, snapshotRoot, manifest, entries, runtimeJson)
    return await writeSnapshotArchive(snapshotRoot, output, entries, manifest)
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true })
  }
}

async function writeSnapshotArchive(
  snapshotRoot: string,
  output: string,
  entries: readonly string[],
  manifest: RuntimeManifest,
): Promise<PackedRuntimeResult> {
  const temporary = join(
    dirname(output),
    `.${basename(output)}.${String(process.pid)}-${randomBytes(8).toString('hex')}.tmp`,
  )
  const file = await open(temporary, 'wx', 0o600)
  const central: CentralEntry[] = []
  let offset = 0
  try {
    for (const entryPath of entries) {
      // Read one private snapshot entry at a time. This bounds peak memory to
      // one input file (plus compression output), rather than retaining the
      // entire multi-gigabyte runtime in a Buffer map.
      const data = await readStableEntry(snapshotRoot, entryPath)
      const deflated = data.length <= maxCompressedInputBytes
        ? deflateRawSync(data, { level: 9 })
        : data
      const method = data.length <= maxCompressedInputBytes && deflated.length < data.length
        ? deflatedMethod
        : storedMethod
      const payload = method === deflatedMethod ? deflated : data
      const name = Buffer.from(entryPath, 'utf8')
      if (name.length > 0xffff) throw new Error(`runtime archive path is too long: ${entryPath}`)
      assertZip32(payload.length, `compressed size for ${entryPath}`)
      assertZip32(data.length, `uncompressed size for ${entryPath}`)
      assertZip32(offset, `local header offset for ${entryPath}`)
      const crc = crc32(data)
      const header = localHeader(name, method, crc, payload.length, data.length)
      await writeAll(file, header, offset)
      offset += header.length
      await writeAll(file, payload, offset)
      central.push({
        name,
        method,
        crc32: crc,
        compressedSize: payload.length,
        uncompressedSize: data.length,
        localOffset: offset - header.length,
      })
      offset += payload.length
    }

    const centralOffset = offset
    for (const entry of central) {
      const header = centralHeader(entry)
      await writeAll(file, header, offset)
      offset += header.length
    }
    const centralSize = offset - centralOffset
    assertZip32(centralOffset, 'central directory offset')
    assertZip32(centralSize, 'central directory size')
    const end = endOfCentralDirectory(central.length, centralSize, centralOffset)
    await writeAll(file, end, offset)
    offset += end.length
    assertZip32(offset, 'archive size')
    await file.sync()
  } catch (error) {
    await file.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  await file.close()

  try {
    await rename(temporary, output)
    await chmod(output, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  const outputMetadata = await stat(output)
  return {
    path: output,
    bytes: outputMetadata.size,
    sha256: await sha256File(output),
    entries,
    manifest,
  }
}

async function createArchiveSnapshot(
  sourceRoot: string,
  snapshotRoot: string,
  manifest: RuntimeManifest,
  entries: readonly string[],
  runtimeJson: Buffer,
): Promise<void> {
  const checksumBytes = await readStableEntry(sourceRoot, 'checksums.sha256')
  const checksums = parseChecksumSnapshot(checksumBytes)
  if (checksums.get('runtime.json') !== createHash('sha256').update(runtimeJson).digest('hex')) {
    throw new Error('runtime archive manifest snapshot checksum changed')
  }
  const expected = new Map(manifest.files.map((file) => [file.path, file] as const))
  if (checksums.size !== manifest.files.length + 1) {
    throw new Error('runtime archive checksum snapshot coverage changed')
  }

  for (const entryPath of entries) {
    const data = entryPath === 'runtime.json'
      ? runtimeJson
      : entryPath === 'checksums.sha256'
        ? checksumBytes
        : await readStableEntry(sourceRoot, entryPath)
    const file = expected.get(entryPath)
    if (file !== undefined) {
      const digest = createHash('sha256').update(data).digest('hex')
      if (data.length !== file.size || digest !== file.sha256 || checksums.get(entryPath) !== digest) {
        throw new Error(`runtime archive payload snapshot changed: ${entryPath}`)
      }
    } else if (entryPath !== 'runtime.json' && entryPath !== 'checksums.sha256') {
      throw new Error(`runtime archive contains an undeclared entry: ${entryPath}`)
    }
    const destination = resolveArchiveEntry(snapshotRoot, entryPath)
    await mkdir(dirname(destination), { mode: 0o700, recursive: true })
    await writeFile(destination, data, { flag: 'wx', mode: 0o600 })
  }
}

function parseChecksumSnapshot(data: Buffer): Map<string, string> {
  const checksums = new Map<string, string>()
  for (const line of data.toString('utf8').split(/\r?\n/u).filter(Boolean)) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/u.exec(line)
    if (match?.[1] === undefined || match[2] === undefined || checksums.has(match[2])) {
      throw new Error('runtime archive checksum snapshot is invalid')
    }
    checksums.set(match[2], match[1])
  }
  return checksums
}

async function readStableEntry(root: string, entryPath: string): Promise<Buffer> {
  const target = resolveArchiveEntry(root, entryPath)
  const flags = fsConstants.O_RDONLY |
    (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
  const file = await open(target, flags)
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error(`runtime archive entry is not a regular file: ${entryPath}`)
    if (before.size > maxInputFileBytes) {
      throw new Error(`runtime archive file exceeds the 128 MiB pack limit: ${entryPath}`)
    }
    const data = Buffer.allocUnsafe(before.size)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset)
      if (bytesRead === 0) throw new Error(`runtime archive entry ended while reading: ${entryPath}`)
      offset += bytesRead
    }
    const after = await file.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`runtime archive entry changed while reading: ${entryPath}`)
    }
    return data
  } finally {
    await file.close()
  }
}

async function assertMissingOutput(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`runtime archive output already exists: ${path}`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function localHeader(
  name: Buffer,
  method: number,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
): Buffer {
  const header = Buffer.alloc(30 + name.length)
  header.writeUInt32LE(localFileHeaderSignature, 0)
  header.writeUInt16LE(zipVersion, 4)
  header.writeUInt16LE(utf8Flag, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt16LE(fixedDosTime, 10)
  header.writeUInt16LE(fixedDosDate, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(compressedSize, 18)
  header.writeUInt32LE(uncompressedSize, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  name.copy(header, 30)
  return header
}

function centralHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(46 + entry.name.length)
  header.writeUInt32LE(centralDirectoryHeaderSignature, 0)
  header.writeUInt16LE(unixZipVersion, 4)
  header.writeUInt16LE(zipVersion, 6)
  header.writeUInt16LE(utf8Flag, 8)
  header.writeUInt16LE(entry.method, 10)
  header.writeUInt16LE(fixedDosTime, 12)
  header.writeUInt16LE(fixedDosDate, 14)
  header.writeUInt32LE(entry.crc32, 16)
  header.writeUInt32LE(entry.compressedSize, 20)
  header.writeUInt32LE(entry.uncompressedSize, 24)
  header.writeUInt16LE(entry.name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(regularFileAttributes, 38)
  header.writeUInt32LE(entry.localOffset, 42)
  entry.name.copy(header, 46)
  return header
}

function endOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(endOfCentralDirectorySignature, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entryCount, 8)
  end.writeUInt16LE(entryCount, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return end
}

async function writeAll(
  file: Awaited<ReturnType<typeof open>>,
  data: Buffer,
  position: number,
): Promise<void> {
  let offset = 0
  while (offset < data.length) {
    const { bytesWritten } = await file.write(data, offset, data.length - offset, position + offset)
    if (bytesWritten === 0) throw new Error('runtime archive write made no progress')
    offset += bytesWritten
  }
}

function resolveArchiveEntry(root: string, entryPath: string): string {
  const target = resolve(root, ...entryPath.split('/'))
  if (!isRuntimePathInside(root, target) || target === root) {
    throw new Error(`unsafe runtime archive entry: ${entryPath}`)
  }
  return target
}

function assertZip32(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maxZip32) {
    throw new Error(`${field} exceeds the ZIP32 limit`)
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

const crcTable = makeCrcTable()

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

function crc32(data: Buffer): number {
  let value = 0xffff_ffff
  for (const byte of data) {
    value = (crcTable[(value ^ byte) & 0xff] as number) ^ (value >>> 8)
  }
  return (value ^ 0xffff_ffff) >>> 0
}

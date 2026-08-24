import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  compareRuntimeNames,
  parseRuntimeManifest,
  runtimePathIdentity,
  validateRuntimePath,
  type RuntimeManifest,
  type RuntimeManifestFile,
  type RuntimeManifestPlugin,
  type RuntimeManifestSignature,
} from '@ldd/runtime-kit/runtime-manifest'

export {
  parseRuntimeManifest,
  runtimePathIdentity,
  validateRuntimePath,
  type RuntimeManifest,
  type RuntimeManifestFile,
  type RuntimeManifestPlugin,
  type RuntimeManifestSignature,
}

const runtimeManifestName = 'runtime.json'
const checksumListName = 'checksums.sha256'
const readBufferBytes = 1024 * 1024

export interface RuntimeManifestOptions {
  readonly harnessVersion: string
  readonly createdAt: string
  readonly minimumLddVersion: string
  readonly sourceArchiveSha256: string
  readonly npmIntegrity: string | null
  readonly signature?: RuntimeManifestSignature
  readonly plugins: readonly RuntimeManifestPlugin[]
}

export async function makeManifest(
  runtimeRoot: string,
  options: RuntimeManifestOptions,
): Promise<RuntimeManifest> {
  const root = await validateRuntimeRoot(runtimeRoot)
  const files = await enumerateRuntimeFiles(root)
  return parseRuntimeManifest({
    formatVersion: 1,
    harnessVersion: options.harnessVersion,
    platform: 'win32',
    arch: 'x64',
    nodeMajor: 24,
    createdAt: options.createdAt,
    minimumLddVersion: options.minimumLddVersion,
    sourceArchiveSha256: options.sourceArchiveSha256,
    npmIntegrity: options.npmIntegrity,
    ...(options.signature === undefined ? {} : { signature: options.signature }),
    plugins: [...options.plugins].sort((left, right) => compareRuntimeNames(left.name, right.name)),
    files,
  })
}

export async function writeRuntimeMetadata(
  runtimeRoot: string,
  options: RuntimeManifestOptions,
): Promise<RuntimeManifest> {
  const root = await validateRuntimeRoot(runtimeRoot)
  const manifest = await makeManifest(root, options)
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
  const checksumBytes = Buffer.from([
    `${manifestSha256} *${runtimeManifestName}`,
    ...manifest.files.map((file) => `${file.sha256} *${file.path}`),
    '',
  ].join('\n'), 'utf8')
  await writeAtomicFile(join(root, runtimeManifestName), manifestBytes)
  await writeAtomicFile(join(root, checksumListName), checksumBytes)
  return manifest
}

export async function readRuntimeManifest(runtimeRoot: string): Promise<RuntimeManifest> {
  const root = await validateRuntimeRoot(runtimeRoot)
  return parseRuntimeManifest(JSON.parse(await readFile(join(root, runtimeManifestName), 'utf8')) as unknown)
}

export async function verifyRuntimeMetadata(runtimeRoot: string): Promise<RuntimeManifest> {
  const root = await validateRuntimeRoot(runtimeRoot)
  const manifest = await readRuntimeManifest(root)
  const actualFiles = await enumerateRuntimeFiles(root)
  if (!equalFileLists(manifest.files, actualFiles)) {
    throw new Error('runtime manifest verification failed: payload file list or digest changed')
  }
  const checksums = parseChecksumList(await readFile(join(root, checksumListName), 'utf8'))
  const manifestDigest = createHash('sha256')
    .update(await readFile(join(root, runtimeManifestName)))
    .digest('hex')
  if (checksums.get(runtimePathIdentity(runtimeManifestName)) !== manifestDigest) {
    throw new Error('runtime manifest verification failed: runtime.json checksum changed')
  }
  for (const file of manifest.files) {
    if (checksums.get(runtimePathIdentity(file.path)) !== file.sha256) {
      throw new Error(`runtime manifest verification failed: checksum list changed for ${file.path}`)
    }
  }
  if (checksums.size !== manifest.files.length + 1) {
    throw new Error('runtime manifest verification failed: checksum list coverage changed')
  }
  return manifest
}

async function enumerateRuntimeFiles(root: string): Promise<RuntimeManifestFile[]> {
  const pending: Array<{ readonly path: string; readonly absolutePath: string }> = []
  const identities = new Set<string>()
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = (await readdir(directory)).sort(compareRuntimeNames)
    for (const name of entries) {
      const path = prefix.length === 0 ? name : `${prefix}/${name}`
      const validated = validateRuntimePath(path)
      if (prefix.length === 0 && (name === runtimeManifestName || name === checksumListName)) continue
      const identity = runtimePathIdentity(validated)
      if (identities.has(identity)) throw new Error(`duplicate normalized runtime path: ${validated}`)
      identities.add(identity)
      const absolutePath = join(directory, name)
      const metadata = await lstat(absolutePath)
      if (metadata.isSymbolicLink()) throw new Error(`runtime payload contains a symbolic link: ${validated}`)
      if (metadata.isDirectory()) {
        await visit(absolutePath, validated)
        continue
      }
      if (!metadata.isFile()) throw new Error(`runtime payload contains a non-file entry: ${validated}`)
      pending.push({ path: validated, absolutePath })
    }
  }
  await visit(root, '')
  const files = await hashFilesConcurrently(pending)
  files.sort((left, right) => compareRuntimeNames(left.path, right.path))
  return files
}

// Hashing the runtime payload serially measured ~5.6 MiB/s on the shipped
// 37932-file tree (~168s) — the bottleneck is per-file open/stat/close and
// antivirus re-scan, not sha256 computation. A bounded worker pool lifts it
// to ~130 MiB/s (~8s) without changing the produced manifest, ordering, or
// fail-closed semantics: each file still goes through hashRegularFile with
// its before/after stat TOCTOU guard, and the final list is still sorted.
const hashConcurrency = 16

async function hashFilesConcurrently(
  entries: readonly { readonly path: string; readonly absolutePath: string }[],
): Promise<RuntimeManifestFile[]> {
  const hashed = new Array<RuntimeManifestFile>(entries.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next
      next += 1
      if (index >= entries.length) return
      const entry = entries[index]
      if (entry === undefined) return
      const digest = await hashRegularFile(entry.absolutePath, entry.path)
      hashed[index] = { path: entry.path, size: digest.size, sha256: digest.sha256 }
    }
  }
  await Promise.all(Array.from({ length: Math.min(hashConcurrency, entries.length) }, () => worker()))
  return hashed
}

async function hashRegularFile(
  absolutePath: string,
  displayPath: string,
): Promise<{ readonly size: number; readonly sha256: string }> {
  const flags = fsConstants.O_RDONLY |
    (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
  const file = await open(absolutePath, flags)
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error(`runtime payload changed shape while hashing: ${displayPath}`)
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(readBufferBytes)
    let position = 0
    while (position < before.size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position)
      if (bytesRead === 0) throw new Error(`runtime payload ended while hashing: ${displayPath}`)
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    const after = await file.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`runtime payload changed while hashing: ${displayPath}`)
    }
    return { size: before.size, sha256: hash.digest('hex') }
  } finally {
    await file.close()
  }
}

async function validateRuntimeRoot(runtimeRoot: string): Promise<string> {
  if (!isAbsolute(runtimeRoot)) throw new TypeError('runtime root must be absolute')
  const root = resolve(runtimeRoot)
  const metadata = await lstat(root)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('runtime root must be a regular directory')
  }
  return root
}

async function writeAtomicFile(path: string, data: Buffer): Promise<void> {
  const temporary = `${path}.tmp-${String(process.pid)}-${createHash('sha256').update(data).digest('hex').slice(0, 12)}`
  await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function parseChecksumList(serialized: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of serialized.split(/\r?\n/).filter((entry) => entry.length > 0)) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error('runtime manifest verification failed: invalid checksum line')
    }
    const identity = runtimePathIdentity(match[2])
    if (result.has(identity)) throw new Error('runtime manifest verification failed: duplicate checksum path')
    result.set(identity, match[1])
  }
  return result
}

function equalFileLists(
  expected: readonly RuntimeManifestFile[],
  actual: readonly RuntimeManifestFile[],
): boolean {
  return expected.length === actual.length && expected.every((file, index) => {
    const candidate = actual[index]
    return candidate !== undefined && candidate.path === file.path &&
      candidate.size === file.size && candidate.sha256 === file.sha256
  })
}

export function isRuntimePathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

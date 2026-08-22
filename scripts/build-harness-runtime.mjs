import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { buildRuntime } from '../packages/runtime-package/src/build-runtime.ts'
import { packRuntime } from '../packages/runtime-package/src/pack.ts'

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    'source-archive': { type: 'string' },
    plugin: { type: 'string' },
    patches: { type: 'string' },
    'out-root': { type: 'string' },
    'out-file': { type: 'string' },
    'created-at': { type: 'string' },
  },
  allowPositionals: false,
  strict: true,
})

const repositoryRoot = resolve(import.meta.dirname, '..')
const defaults = {
  source: join(repositoryRoot, 'upstream', 'deepseek-harness'),
  sourceArchive: process.env.LDD_HARNESS_SOURCE_ARCHIVE ??
    join(repositoryRoot, 'vendor', 'sources', 'deepseek-harness-0.1.1-rc.2.zip'),
  plugin: join(repositoryRoot, 'packages', 'video-frame-analyzer'),
  patches: join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.1-rc.2'),
  outputRoot: join(repositoryRoot, 'dist', 'runtime', '0.1.1-rc.2'),
  outputFile: join(repositoryRoot, 'dist', 'runtime', 'deepseek-harness-0.1.1-rc.2-windows-x64.lddruntime'),
}
const selected = {
  source: values.source ?? defaults.source,
  sourceArchive: values['source-archive'] ?? defaults.sourceArchive,
  plugin: values.plugin ?? defaults.plugin,
  patches: values.patches ?? defaults.patches,
  outputRoot: values['out-root'] ?? defaults.outputRoot,
  outputFile: values['out-file'] ?? defaults.outputFile,
}
for (const [field, path] of Object.entries(selected)) {
  if (!isAbsolute(path)) throw new Error(`${field} must be an absolute path`)
}

const createdAt = values['created-at'] ?? sourceDateEpoch() ?? '2026-08-22T00:00:00.000Z'
const sourceRoot = resolve(selected.source)
const sourceArchive = resolve(selected.sourceArchive)
const pluginRoot = resolve(selected.plugin)
const patchRoot = resolve(selected.patches)
const outputRoot = resolve(selected.outputRoot)
const outputFile = resolve(selected.outputFile)

await assertRegularFile(sourceArchive, 'Harness source archive')
await mkdir(dirname(outputRoot), { recursive: true })
await mkdir(dirname(outputFile), { recursive: true })
const sourceArchiveSha256 = await hashFile(sourceArchive)
const publication = await mkdtemp(join(dirname(outputRoot), '.ldd-runtime-publication-'))
const pendingRoot = join(publication, 'runtime')
const pendingFile = join(publication, 'runtime.lddruntime')
let packed
try {
  const built = await buildRuntime(sourceRoot, pendingRoot, {
    sourceArchiveSha256,
    videoPluginRoot: pluginRoot,
    upstreamPatchRoot: patchRoot,
    createdAt,
    pnpmExecutable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  })
  packed = await packRuntime(built.runtimeRoot, pendingFile)
  await publishReplacing(pendingRoot, outputRoot, pendingFile, outputFile)
} finally {
  await rm(publication, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify({
  harnessVersion: packed.manifest.harnessVersion,
  runtimeRoot: outputRoot,
  archive: outputFile,
  archiveBytes: packed.bytes,
  archiveSha256: packed.sha256,
  sourceArchiveSha256,
}, null, 2)}\n`)

function sourceDateEpoch() {
  const raw = process.env.SOURCE_DATE_EPOCH
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) throw new Error('SOURCE_DATE_EPOCH must be an integer')
  const milliseconds = Number(raw) * 1_000
  if (!Number.isSafeInteger(milliseconds)) throw new Error('SOURCE_DATE_EPOCH is outside the safe date range')
  return new Date(milliseconds).toISOString()
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function assertRegularFile(path, field) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${field} must be a regular file`)
}

async function publishReplacing(pendingRoot, outputRoot, pendingFile, outputFile) {
  const nonce = randomBytes(8).toString('hex')
  const rootBackup = `${outputRoot}.previous-${nonce}`
  const fileBackup = `${outputFile}.previous-${nonce}`
  let rootBackedUp = false
  let fileBackedUp = false
  let rootPublished = false
  let filePublished = false
  try {
    rootBackedUp = await backUpExisting(outputRoot, rootBackup, 'directory')
    fileBackedUp = await backUpExisting(outputFile, fileBackup, 'file')
    await rename(pendingRoot, outputRoot)
    rootPublished = true
    await rename(pendingFile, outputFile)
    filePublished = true
  } catch (error) {
    if (filePublished) await rm(outputFile, { force: true }).catch(() => undefined)
    if (rootPublished) await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined)
    if (fileBackedUp) await rename(fileBackup, outputFile).catch(() => undefined)
    if (rootBackedUp) await rename(rootBackup, outputRoot).catch(() => undefined)
    throw error
  }
  if (fileBackedUp) await rm(fileBackup, { force: true })
  if (rootBackedUp) await rm(rootBackup, { recursive: true, force: true })
}

async function backUpExisting(path, backup, expectedKind) {
  try {
    const metadata = await lstat(path)
    if (
      metadata.isSymbolicLink() ||
      (expectedKind === 'directory' ? !metadata.isDirectory() : !metadata.isFile())
    ) {
      throw new Error(`existing runtime ${expectedKind} has an unsafe shape: ${path}`)
    }
    await rename(path, backup)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

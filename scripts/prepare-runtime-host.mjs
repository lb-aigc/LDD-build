import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { downloadPinned } from './download-pinned.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceManifestPath = join(repositoryRoot, 'vendor', 'runtime-sources.json')
const outputRoot = join(repositoryRoot, 'vendor', 'runtime-host')
const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))

if (await pathExists(outputRoot)) {
  await verifyRuntimeHost(outputRoot)
} else {
  const transaction = await mkdtemp(join(dirname(outputRoot), '.runtime-host-'))
  try {
    const downloads = join(transaction, 'downloads')
    const extracted = join(transaction, 'extracted')
    const staged = join(transaction, 'runtime-host')
    await mkdir(downloads, { recursive: true })
    await mkdir(extracted, { recursive: true })
    await mkdir(staged, { recursive: true })

    const nodeArchive = join(downloads, 'node.zip')
    await downloadPinned([manifest.node.url], manifest.node.sha256, nodeArchive, 128 * 1024 * 1024)
    const nodeExtracted = join(extracted, 'node')
    await extractPinnedZip(nodeArchive, nodeExtracted)
    const nodeRoot = await requireSingleDirectory(nodeExtracted)
    await mkdir(join(staged, 'node'), { recursive: true })
    for (const name of ['node.exe', 'LICENSE', 'README.md']) {
      await copyFile(join(nodeRoot, name), join(staged, 'node', name))
    }
    await assertRegularFile(join(staged, 'node', 'node.exe'), 'Node executable')

    const ffmpegArchive = join(downloads, 'ffmpeg.zip')
    await downloadPinned(manifest.ffmpeg.urls, manifest.ffmpeg.sha256, ffmpegArchive, 512 * 1024 * 1024)
    const ffmpegExtracted = join(extracted, 'ffmpeg')
    await extractPinnedZip(ffmpegArchive, ffmpegExtracted)
    const ffmpegRoot = await requireSingleDirectory(ffmpegExtracted)
    await mkdir(join(staged, 'ffmpeg', 'bin'), { recursive: true })
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      await copyFile(join(ffmpegRoot, 'bin', name), join(staged, 'ffmpeg', 'bin', name))
    }
    for (const name of ['LICENSE', 'README.txt']) {
      await copyFile(join(ffmpegRoot, name), join(staged, 'ffmpeg', name))
    }
    await assertRegularFile(join(staged, 'ffmpeg', 'bin', 'ffmpeg.exe'), 'FFmpeg executable')
    await assertRegularFile(join(staged, 'ffmpeg', 'bin', 'ffprobe.exe'), 'FFprobe executable')

    const pnpmArchive = process.env.LDD_PNPM_ARCHIVE === undefined
      ? join(downloads, `pnpm-${manifest.pnpm.version}.tgz`)
      : resolve(process.env.LDD_PNPM_ARCHIVE)
    if (process.env.LDD_PNPM_ARCHIVE === undefined) {
      await downloadPinned([manifest.pnpm.url], manifest.pnpm.archiveSha256, pnpmArchive, 32 * 1024 * 1024)
    }
    await assertDigest(pnpmArchive, manifest.pnpm.archiveSha256, 'pnpm archive')
    const pnpmExtracted = join(extracted, 'pnpm')
    await extractPinnedTar(pnpmArchive, pnpmExtracted)
    const pnpmEntry = join(pnpmExtracted, 'package', 'bin', 'pnpm.cjs')
    await assertRegularFile(pnpmEntry, 'pnpm entry')
    await cp(join(pnpmExtracted, 'package'), join(staged, 'pnpm'), { recursive: true })

    await rename(staged, outputRoot)
  } finally {
    await rm(transaction, { recursive: true, force: true })
  }
  await verifyRuntimeHost(outputRoot)
}

process.stdout.write(`${outputRoot}\n`)

async function extractPinnedZip(archive, destination) {
  await assertSafeArchiveListing(archive, 'zip')
  await mkdir(destination, { recursive: true })
  if (process.platform === 'win32') {
    await run(tarExecutable(), ['-xf', archive, '-C', destination])
  } else {
    await run('unzip', ['-q', archive, '-d', destination])
  }
}

async function extractPinnedTar(archive, destination) {
  await assertSafeArchiveListing(archive, 'tar')
  await mkdir(destination, { recursive: true })
  await run(tarExecutable(), ['-xzf', archive, '-C', destination])
}

async function assertSafeArchiveListing(archive, kind) {
  const listing = kind === 'zip' && process.platform !== 'win32'
    ? await run('unzip', ['-Z1', archive], true)
    : await run(tarExecutable(), [kind === 'tar' ? '-tzf' : '-tf', archive], true)
  for (const raw of listing.split(/\r?\n/u).filter(Boolean)) {
    const path = raw.replaceAll('\\', '/')
    if (path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.split('/').includes('..')) {
      throw new Error(`archive contains an unsafe path: ${JSON.stringify(raw)}`)
    }
  }
}

function tarExecutable() {
  return process.platform === 'win32' ? 'tar.exe' : 'tar'
}

async function run(command, args, capture = false) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout = bounded(stdout + chunk) })
    child.stderr.on('data', (chunk) => { stderr = bounded(stderr + chunk) })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(stdout)
      else reject(new Error(`${command} failed (${String(code)}/${String(signal)}): ${stderr.trim()}`))
    })
  })
}

function bounded(value) {
  return value.length <= 1024 * 1024 ? value : value.slice(-1024 * 1024)
}

async function requireSingleDirectory(root) {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.length !== 1 || !entries[0].isDirectory()) throw new Error(`archive root is not a single directory: ${root}`)
  return join(root, entries[0].name)
}

async function assertDigest(path, expected, field) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== expected) throw new Error(`${field} digest mismatch`)
}

async function verifyRuntimeHost(root) {
  await assertDigest(join(root, 'node', 'node.exe'), manifest.node.executableSha256, 'Node executable')
  await assertDigest(join(root, 'pnpm', 'bin', 'pnpm.cjs'), manifest.pnpm.entrySha256, 'pnpm entry')
  await assertDigest(join(root, 'ffmpeg', 'bin', 'ffmpeg.exe'), manifest.ffmpeg.ffmpegSha256, 'FFmpeg executable')
  await assertDigest(join(root, 'ffmpeg', 'bin', 'ffprobe.exe'), manifest.ffmpeg.ffprobeSha256, 'FFprobe executable')
  const packageManifest = JSON.parse(await readFile(join(root, 'pnpm', 'package.json'), 'utf8'))
  if (packageManifest.version !== manifest.pnpm.version) throw new Error('pnpm runtime-host version mismatch')
}

async function assertRegularFile(path, field) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${field} must be a regular file`)
}

async function pathExists(path) {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('runtime host is link-shaped or not a directory')
    }
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

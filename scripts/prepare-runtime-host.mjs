import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { downloadPinned } from './download-pinned.mjs'
import { hostPlatformKey, isWindowsHost } from './runtime-platform.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceManifestPath = join(repositoryRoot, 'vendor', 'runtime-sources.json')
const outputRoot = join(repositoryRoot, 'vendor', 'runtime-host')
const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const platformKey = hostPlatformKey()
const nodeTarget = manifest.node.targets[platformKey]
const ffmpegTarget = manifest.ffmpeg.targets[platformKey]
if (nodeTarget === undefined || ffmpegTarget === undefined) {
  throw new Error(`runtime-sources.json has no target for host platform ${platformKey}`)
}

const nodeBinaryName = isWindowsHost() ? 'node.exe' : 'node'
const ffmpegBinaryName = isWindowsHost() ? 'ffmpeg.exe' : 'ffmpeg'
const ffprobeBinaryName = isWindowsHost() ? 'ffprobe.exe' : 'ffprobe'

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

    // ---- Node ----
    const nodeArchive = join(downloads, `node.${nodeTarget.kind === 'zip' ? 'zip' : 'tar.gz'}`)
    await downloadPinned([nodeTarget.url], nodeTarget.archiveSha256, nodeArchive, 128 * 1024 * 1024)
    const nodeExtracted = join(extracted, 'node')
    await extractPinnedArchive(nodeArchive, nodeExtracted, nodeTarget.kind)
    const nodeRoot = await requireSingleDirectory(nodeExtracted)
    await mkdir(join(staged, 'node'), { recursive: true })
    await copyFile(join(nodeRoot, nodeTarget.executablePath), join(staged, 'node', nodeBinaryName))
    for (const name of ['LICENSE', 'README.md']) {
      await copyFile(join(nodeRoot, name), join(staged, 'node', name))
    }
    await assertRegularFile(join(staged, 'node', nodeBinaryName), 'Node executable')

    // ---- FFmpeg ----
    await mkdir(join(staged, 'ffmpeg', 'bin'), { recursive: true })
    if (ffmpegTarget.kind === 'zip') {
      const ffmpegArchive = join(downloads, 'ffmpeg.zip')
      await downloadPinned(ffmpegTarget.urls, ffmpegTarget.archiveSha256, ffmpegArchive, 512 * 1024 * 1024)
      const ffmpegExtracted = join(extracted, 'ffmpeg')
      await extractPinnedArchive(ffmpegArchive, ffmpegExtracted, 'zip')
      const ffmpegRoot = await requireSingleDirectory(ffmpegExtracted)
      await copyFile(join(ffmpegRoot, ffmpegTarget.ffmpegPath), join(staged, 'ffmpeg', 'bin', ffmpegBinaryName))
      await copyFile(join(ffmpegRoot, ffmpegTarget.ffprobePath), join(staged, 'ffmpeg', 'bin', ffprobeBinaryName))
      for (const name of ['LICENSE', 'README.txt']) {
        await copyFile(join(ffmpegRoot, name), join(staged, 'ffmpeg', name))
      }
    } else {
      // Raw static binaries (ffmpeg-static): download directly, no extraction.
      const ffmpegBinary = join(downloads, 'ffmpeg')
      const ffprobeBinary = join(downloads, 'ffprobe')
      await downloadPinned([ffmpegTarget.ffmpegUrl], ffmpegTarget.ffmpegSha256, ffmpegBinary, 512 * 1024 * 1024)
      await downloadPinned([ffmpegTarget.ffprobeUrl], ffmpegTarget.ffprobeSha256, ffprobeBinary, 512 * 1024 * 1024)
      await copyFile(ffmpegBinary, join(staged, 'ffmpeg', 'bin', ffmpegBinaryName))
      await copyFile(ffprobeBinary, join(staged, 'ffmpeg', 'bin', ffprobeBinaryName))
    }
    await assertRegularFile(join(staged, 'ffmpeg', 'bin', ffmpegBinaryName), 'FFmpeg executable')
    await assertRegularFile(join(staged, 'ffmpeg', 'bin', ffprobeBinaryName), 'FFprobe executable')

    // ---- pnpm ----
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
    // pnpm ships only `.cjs`/`.mjs` entrypoints. Add launcher shims so a child
    // spawned by bare name (`pnpm`/`pnpx`) resolves on PATH — the dsh `plugin`
    // forwarder and third-party installers (e.g. dshmarket) spawn `pnpm`
    // without an extension, and Node's spawn cannot start a `.cjs` without a
    // shell shim. Windows gets `.cmd` batch shims; POSIX gets executable shell
    // shims driven through the bundled node via a relative path.
    const nodeFromPnpmBin = join('..', '..', 'node', nodeBinaryName)
    if (isWindowsHost()) {
      await writeFile(join(staged, 'pnpm', 'bin', 'pnpm.cmd'),
        `@echo off\r\n"%~dp0${nodeFromPnpmBin}" "%~dp0pnpm.cjs" %*\r\n`)
      await writeFile(join(staged, 'pnpm', 'bin', 'pnpx.cmd'),
        `@echo off\r\n"%~dp0${nodeFromPnpmBin}" "%~dp0pnpx.cjs" %*\r\n`)
    } else {
      await writeFile(join(staged, 'pnpm', 'bin', 'pnpm'),
        `#!/bin/sh\nexec "$(dirname "$0")/${nodeFromPnpmBin}" "$(dirname "$0")/pnpm.cjs" "$@"\n`)
      await writeFile(join(staged, 'pnpm', 'bin', 'pnpx'),
        `#!/bin/sh\nexec "$(dirname "$0")/${nodeFromPnpmBin}" "$(dirname "$0")/pnpx.cjs" "$@"\n`)
      await chmod(join(staged, 'pnpm', 'bin', 'pnpm'), 0o755)
      await chmod(join(staged, 'pnpm', 'bin', 'pnpx'), 0o755)
    }

    // POSIX binaries must carry the execute bit after copyFile.
    if (!isWindowsHost()) {
      await chmod(join(staged, 'node', nodeBinaryName), 0o755)
      await chmod(join(staged, 'ffmpeg', 'bin', ffmpegBinaryName), 0o755)
      await chmod(join(staged, 'ffmpeg', 'bin', ffprobeBinaryName), 0o755)
    }

    await rename(staged, outputRoot)
  } finally {
    await rm(transaction, { recursive: true, force: true })
  }
  await verifyRuntimeHost(outputRoot)
}

process.stdout.write(`${outputRoot}\n`)

async function extractPinnedArchive(archive, destination, kind) {
  await assertSafeArchiveListing(archive, kind)
  await mkdir(destination, { recursive: true })
  if (kind === 'zip') {
    if (process.platform === 'win32') {
      await run(tarExecutable(), ['-xf', archive, '-C', destination])
    } else {
      await run('unzip', ['-q', archive, '-d', destination])
    }
  } else if (kind === 'tar.gz') {
    await run(tarExecutable(), ['-xzf', archive, '-C', destination])
  } else {
    throw new Error(`unsupported archive kind: ${kind}`)
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
    : await run(tarExecutable(), [kind === 'tar' || kind === 'tar.gz' ? '-tzf' : '-tf', archive], true)
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
  await assertDigest(join(root, 'node', nodeBinaryName), nodeTarget.executableSha256, 'Node executable')
  await assertDigest(join(root, 'pnpm', 'bin', 'pnpm.cjs'), manifest.pnpm.entrySha256, 'pnpm entry')
  if (isWindowsHost()) {
    await assertRegularFile(join(root, 'pnpm', 'bin', 'pnpm.cmd'), 'pnpm cmd shim')
    await assertRegularFile(join(root, 'pnpm', 'bin', 'pnpx.cmd'), 'pnpx cmd shim')
  } else {
    await assertRegularFile(join(root, 'pnpm', 'bin', 'pnpm'), 'pnpm posix shim')
    await assertRegularFile(join(root, 'pnpm', 'bin', 'pnpx'), 'pnpx posix shim')
  }
  await assertDigest(join(root, 'ffmpeg', 'bin', ffmpegBinaryName), ffmpegTarget.ffmpegSha256, 'FFmpeg executable')
  await assertDigest(join(root, 'ffmpeg', 'bin', ffprobeBinaryName), ffmpegTarget.ffprobeSha256, 'FFprobe executable')
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

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  copyTrackedEntryWindowsCompatible,
  createSourceFileInventory,
  sourceFileInventoryName,
} from './source-package-tree.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const releaseRoot = join(repositoryRoot, 'release')
const output = join(releaseRoot, 'LDD-0.2.0-source.zip')
const temporary = join(releaseRoot, `.LDD-0.2.0-source-${randomBytes(8).toString('hex')}.tmp`)
const staging = join(releaseRoot, `.LDD-0.2.0-source-tree-${randomBytes(8).toString('hex')}`)

const status = await runGit(['status', '--porcelain=v1', '--untracked-files=all'], true)
if (status.trim().length > 0) {
  const dirty = status.trim().split('\n').slice(0, 50).join('\n')
  throw new Error(`source packaging requires a clean Git worktree so the archive cannot omit local changes\nDirty entries (first 50):\n${dirty}`)
}
await mkdir(releaseRoot, { mode: 0o700, recursive: true })
try {
  const entries = parseTree(await runGit(
    ['ls-tree', '-rz', '--full-tree', 'HEAD'],
    true,
    repositoryRoot,
    {},
    32 * 1024 * 1024,
  ))
  const sourceEntries = entries.filter((entry) => entry.path !== sourceFileInventoryName)
  await mkdir(staging, { mode: 0o700 })
  for (const entry of sourceEntries) {
    if (entry.type !== 'blob') throw new Error(`unsupported tracked source entry type: ${entry.type} ${entry.path}`)
    await copyTrackedEntryWindowsCompatible(repositoryRoot, staging, entry.path, entry.mode)
  }
  await writeFile(
    join(staging, sourceFileInventoryName),
    createSourceFileInventory(sourceEntries.map((entry) => entry.path)),
    { flag: 'wx', mode: 0o644 },
  )
  await runGit(['init', '--quiet'], false, staging)
  await runGit(['-c', 'core.autocrlf=false', '-c', 'core.filemode=true', 'add', '--force', '-A'], false, staging)
  const tree = (await runGit(['write-tree'], true, staging)).trim()
  const timestamp = (await runGit(['show', '-s', '--format=%ct', 'HEAD'], true)).trim()
  const commit = (await runGit(['commit-tree', tree, '-m', 'LDD 0.2.0 source'], true, staging, {
    GIT_AUTHOR_NAME: 'LDD Source Packager',
    GIT_AUTHOR_EMAIL: 'source@localhost',
    GIT_AUTHOR_DATE: `${timestamp} +0000`,
    GIT_COMMITTER_NAME: 'LDD Source Packager',
    GIT_COMMITTER_EMAIL: 'source@localhost',
    GIT_COMMITTER_DATE: `${timestamp} +0000`,
  })).trim()
  await runGit([
    'archive',
    '--format=zip',
    '--prefix=LDD-0.2.0/',
    `--output=${temporary}`,
    commit,
  ], false, staging)
  await replaceRegularFile(temporary, output)
} finally {
  await rm(temporary, { force: true })
  await rm(staging, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify({
  path: output,
  sha256: await hashFile(output),
}, null, 2)}\n`)

async function runGit(args, capture = false, cwd = repositoryRoot, extraEnv = {}, captureLimit = 64 * 1024) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      shell: false,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let captureError
    child.stdout?.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      if (captureError) return
      stdout += chunk
      if (stdout.length > captureLimit) {
        captureError = new Error(`git ${args[0]} exceeded its ${captureLimit}-character output limit`)
        child.kill()
      }
    })
    child.stderr.on('data', (chunk) => { stderr = bounded(stderr + chunk) })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (captureError) reject(captureError)
      else if (code === 0) resolveRun(stdout)
      else reject(new Error(`git ${args[0]} failed (${String(code)}/${String(signal)}): ${stderr.trim()}`))
    })
  })
}

function parseTree(output) {
  return output.split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t')
    const header = record.slice(0, tab).split(' ')
    if (tab < 0 || header.length !== 3) throw new Error('git ls-tree returned malformed source metadata')
    return { mode: header[0], type: header[1], path: record.slice(tab + 1) }
  })
}

async function replaceRegularFile(source, destination) {
  const backup = `${destination}.previous-${randomBytes(8).toString('hex')}`
  let backedUp = false
  try {
    try {
      const metadata = await lstat(destination)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`refusing to replace non-regular source archive: ${destination}`)
      }
      await rename(destination, backup)
      backedUp = true
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await rename(source, destination)
  } catch (error) {
    if (backedUp) await rename(backup, destination).catch(() => undefined)
    throw error
  }
  if (backedUp) await rm(backup, { force: true })
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function bounded(value) {
  return value.length <= 64 * 1024 ? value : value.slice(-64 * 1024)
}

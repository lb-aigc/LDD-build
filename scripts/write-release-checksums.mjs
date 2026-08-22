import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const releaseRoot = join(repositoryRoot, 'release')
const artifacts = [
  join(releaseRoot, 'LDD-0.2.0-source.zip'),
  join(releaseRoot, 'LDD-Setup-0.2.0-x64.exe'),
  join(releaseRoot, 'deepseek-harness-0.1.1-rc.2-windows-x64.lddruntime'),
].sort((left, right) => basename(left).localeCompare(basename(right), 'en'))

await mkdir(releaseRoot, { mode: 0o700, recursive: true })
const lines = []
for (const path of artifacts) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`release artifact is not a regular file: ${path}`)
  }
  lines.push(`${await hashFile(path)} *${basename(path)}`)
}

const output = join(releaseRoot, 'checksums.sha256')
const temporary = join(releaseRoot, `.checksums-${randomBytes(8).toString('hex')}.tmp`)
await writeFile(temporary, `${lines.join('\n')}\n`, { flag: 'wx', mode: 0o600 })
const backup = `${output}.previous-${randomBytes(8).toString('hex')}`
let backedUp = false
try {
  try {
    const metadata = await lstat(output)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error('refusing to replace a non-regular checksum file')
    }
    await rename(output, backup)
    backedUp = true
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  await rename(temporary, output)
} catch (error) {
  if (backedUp) await rename(backup, output).catch(() => undefined)
  throw error
} finally {
  await rm(temporary, { force: true })
}
if (backedUp) await rm(backup, { force: true })
process.stdout.write(`${output}\n`)

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

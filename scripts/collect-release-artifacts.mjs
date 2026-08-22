import { randomBytes } from 'node:crypto'
import { copyFile, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const filename = 'deepseek-harness-0.1.1-rc.2-windows-x64.lddruntime'
const source = join(repositoryRoot, 'dist', 'runtime', filename)
const releaseRoot = join(repositoryRoot, 'release')
const destination = join(releaseRoot, filename)
const temporary = join(releaseRoot, `.${filename}.${randomBytes(8).toString('hex')}.tmp`)

await assertRegularFile(source, 'built runtime archive')
await mkdir(releaseRoot, { mode: 0o700, recursive: true })
await copyFile(source, temporary)
await assertRegularFile(temporary, 'copied runtime archive')
const backup = `${destination}.previous-${randomBytes(8).toString('hex')}`
let backedUp = false
try {
  try {
    const metadata = await lstat(destination)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`refusing to replace non-regular release artifact: ${destination}`)
    }
    await rename(destination, backup)
    backedUp = true
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  await rename(temporary, destination)
} catch (error) {
  if (backedUp) await rename(backup, destination).catch(() => undefined)
  throw error
} finally {
  await rm(temporary, { force: true })
}
if (backedUp) await rm(backup, { force: true })
process.stdout.write(`${basename(destination)}\n`)

async function assertRegularFile(path, field) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${field} must be a regular file`)
  }
}

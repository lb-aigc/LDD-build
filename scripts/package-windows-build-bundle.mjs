import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const releaseRoot = join(repositoryRoot, 'release')
const source = join(releaseRoot, 'LDD-0.2.0-source.zip')
const destination = join(releaseRoot, 'LDD-0.2.0-Windows-OneClick-Build.zip')
const temporary = join(releaseRoot, `.LDD-Windows-Build-${randomBytes(8).toString('hex')}.tmp`)
const assembly = await mkdtemp(join(releaseRoot, '.LDD-Windows-Build-tree-'))
const runtimeHost = join(repositoryRoot, 'vendor', 'runtime-host')

await assertRegularFile(source, 'source package')
for (const path of [
  join(runtimeHost, 'node', 'node.exe'),
  join(runtimeHost, 'ffmpeg', 'bin', 'ffmpeg.exe'),
  join(runtimeHost, 'ffmpeg', 'bin', 'ffprobe.exe'),
  join(runtimeHost, 'pnpm', 'bin', 'pnpm.cjs'),
]) await assertRegularFile(path, 'offline runtime host entry')
await run('unzip', ['-q', source, '-d', assembly])
const bundledRuntimeHost = join(assembly, 'LDD-0.2.0', 'vendor', 'runtime-host')
await mkdir(join(bundledRuntimeHost, '..'), { recursive: true })
await cp(runtimeHost, bundledRuntimeHost, { recursive: true })
await run('zip', ['-q', '-r', temporary, 'LDD-0.2.0'], assembly)
const backup = `${destination}.previous-${randomBytes(8).toString('hex')}`
let backedUp = false
try {
  try {
    await assertRegularFile(destination, 'existing Windows build bundle')
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
  await rm(assembly, { recursive: true, force: true })
}

async function run(command, args, cwd = repositoryRoot) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} failed with exit code ${String(code)}`)))
  })
}
if (backedUp) await rm(backup, { force: true })
process.stdout.write(`${destination}\n`)

async function assertRegularFile(path, field) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${field} must be a regular file: ${path}`)
  }
}

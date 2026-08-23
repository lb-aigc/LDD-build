import { chmod, cp, lstat, mkdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export async function copyTrackedEntryWindowsCompatible(sourceRoot, destinationRoot, path, mode) {
  const source = resolve(sourceRoot, path)
  const destination = resolve(destinationRoot, path)
  assertWithin(destinationRoot, destination, 'destination')
  const metadata = await lstat(source)
  const isTrackedLink = mode === '120000'
  if (!isTrackedLink && metadata.isSymbolicLink()) {
    throw new Error(`tracked mode does not match working-tree entry: ${path}`)
  }

  await mkdir(dirname(destination), { recursive: true })
  if (isTrackedLink) {
    const target = await readTrackedLink(source, metadata)
    const [canonicalSourceRoot, resolvedTarget] = await Promise.all([
      realpath(sourceRoot),
      realpath(resolve(dirname(source), target)),
    ])
    assertWithin(canonicalSourceRoot, resolvedTarget, 'symlink target')
    await writeFile(destination, target, { flag: 'wx', mode: 0o644 })
    return
  }
  await cp(source, destination, {
    recursive: metadata.isDirectory(),
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  })
  if (!metadata.isDirectory()) {
    await chmod(destination, mode === '100755' ? 0o755 : 0o644)
  }
}

async function readTrackedLink(source, metadata) {
  if (metadata.isSymbolicLink()) return await readlink(source)
  if (!metadata.isFile() || metadata.size > 4096) {
    throw new Error(`invalid Git symlink placeholder: ${source}`)
  }
  const target = await readFile(source, 'utf8')
  if (target.length === 0 || target.includes('\0') || target.includes('\n') || target.includes('\r')) {
    throw new Error(`invalid Git symlink placeholder: ${source}`)
  }
  return target
}

function assertWithin(root, candidate, label) {
  const path = relative(resolve(root), resolve(candidate))
  if (path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) {
    throw new Error(`${label} escapes the source tree: ${candidate}`)
  }
}

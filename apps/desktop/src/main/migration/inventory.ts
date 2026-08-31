import { constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sha256File } from '@ldd/runtime-kit/checksum'

export type InventoryEntry =
  | {
      readonly kind: 'directory'
      readonly path: string
    }
  | {
      readonly kind: 'file'
      readonly path: string
      readonly size: number
      readonly sha256: string
    }

export async function inventoryTree(root: string): Promise<readonly InventoryEntry[]> {
  const rootState = await inspectRoot(root)
  if (rootState === 'absent') {
    return []
  }
  const entries: InventoryEntry[] = []
  await walk(root, [], entries)
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

export async function copyInventory(
  sourceRoot: string,
  destinationRoot: string,
  inventory: readonly InventoryEntry[],
): Promise<void> {
  await mkdir(destinationRoot, { mode: 0o700, recursive: false })
  for (const entry of inventory) {
    const destination = resolveInventoryPath(destinationRoot, entry.path)
    if (entry.kind === 'directory') {
      await mkdir(destination, { mode: 0o700, recursive: true })
    }
  }
  for (const entry of inventory) {
    if (entry.kind !== 'file') continue
    const source = resolveInventoryPath(sourceRoot, entry.path)
    const destination = resolveInventoryPath(destinationRoot, entry.path)
    await mkdir(dirname(destination), { mode: 0o700, recursive: true })
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL)
    await chmod(destination, 0o600)
  }
}

export async function verifyInventory(
  root: string,
  expected: readonly InventoryEntry[],
): Promise<void> {
  const actual = await inventoryTree(root)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('copied Harness data does not match its source inventory')
  }
}

async function walk(
  absoluteDirectory: string,
  relativeSegments: readonly string[],
  output: InventoryEntry[],
): Promise<void> {
  const directoryEntries = await readdir(absoluteDirectory, { withFileTypes: true })
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const directoryEntry of directoryEntries) {
    const absolutePath = join(absoluteDirectory, directoryEntry.name)
    const childSegments = [...relativeSegments, directoryEntry.name]
    const relativePath = childSegments.join('/')
    // The TOP-LEVEL profiles/node_modules tree is installation-owned: Harness
    // recreates it at boot as symlinks to the active runtime, so it must never
    // be copied into a backup or another candidate's data. Deeper node_modules
    // dirs (profiles/*/node_modules) hold user-installed profile plugins (e.g.
    // the dshmarket plugin center) and MUST be preserved — they contain no
    // link-shaped entries, so the refusal below still applies to them.
    if (relativePath === 'profiles/node_modules') continue
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) {
      throw new Error(`link-shaped Harness data entry is not allowed: ${relativePath}`)
    }
    if (metadata.isDirectory()) {
      output.push({ kind: 'directory', path: relativePath })
      await walk(absolutePath, childSegments, output)
    } else if (metadata.isFile()) {
      output.push({
        kind: 'file',
        path: relativePath,
        size: metadata.size,
        sha256: await sha256File(absolutePath),
      })
    } else {
      throw new Error(`special Harness data entry is not allowed: ${relativePath}`)
    }
  }
}

async function inspectRoot(root: string): Promise<'absent' | 'directory'> {
  try {
    const metadata = await lstat(root)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Harness data root is link-shaped or not a directory: ${root}`)
    }
    return 'directory'
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return 'absent'
    }
    throw error
  }
}

function resolveInventoryPath(root: string, relativePath: string): string {
  const segments = relativePath.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`invalid Harness inventory path: ${relativePath}`)
  }
  return join(root, ...segments)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

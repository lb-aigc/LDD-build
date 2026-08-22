import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomicText } from '@ldd/runtime-kit/atomic-json'
import { renderManagedImagePatch, type ImageMode } from './image-mode.ts'

export async function writeManagedImagePatch(
  dshHome: string,
  mode: ImageMode,
): Promise<string> {
  await mkdir(dshHome, { mode: 0o700, recursive: true })
  const managedRoot = join(dshHome, 'ldd-managed')
  await ensurePrivateDirectory(managedRoot)
  const patchPath = join(managedRoot, 'cordis.patch.yml')
  await writeAtomicText(patchPath, renderManagedImagePatch(mode))
  return patchPath
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('LDD managed patch root is link-shaped or not a directory')
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error
    }
    await mkdir(path, { mode: 0o700, recursive: false })
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

import { lstat, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomicText } from '@ldd/runtime-kit/atomic-json'
import { renderManagedImagePatch, type ImageMode } from './image-mode.ts'

/** The web profile's package name for the canvas bundle (the npm package name,
 *  not the `ldd-canvas` bundle id). */
const CANVAS_BUNDLE = '@ldd/dsh-canvas'
const WEB_PROFILE = 'web'

export async function writeManagedImagePatch(
  dshHome: string,
  mode: ImageMode,
): Promise<string> {
  await mkdir(dshHome, { mode: 0o700, recursive: true })
  const managedRoot = join(dshHome, 'ldd-managed')
  await ensurePrivateDirectory(managedRoot)
  const patchPath = join(managedRoot, 'cordis.patch.yml')
  // Dual-track: if the web profile installs the canvas as a bundle (via the
  // plugin market), the built-in insert must be omitted so the plugin is not
  // loaded twice (which would double-register its tools / slots / events). On
  // a fresh profile (no manifest yet) this falls back to the built-in canvas.
  const skipCanvas = await hasCanvasBundle(dshHome)
  await writeAtomicText(patchPath, renderManagedImagePatch(mode, { skipCanvas }))
  return patchPath
}

/** Whether the web profile already lists @ldd/dsh-canvas in its bundles. */
async function hasCanvasBundle(dshHome: string): Promise<boolean> {
  const manifestPath = join(dshHome, 'profiles', WEB_PROFILE, 'package.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) && bundles.includes(CANVAS_BUNDLE)
  } catch {
    return false
  }
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

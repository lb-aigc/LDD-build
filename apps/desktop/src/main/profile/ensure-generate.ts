import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'

/**
 * LDD's own generation bundle, registered as a profile bundle so its volatile
 * settings fields (image/video/music model config) are editable through the
 * 0.2.0 settings document. Registering it through the `--patch` overlay instead
 * makes config-editor reject every write with "Configuration ... is overridden
 * by a home patch or command-line overlay", because a command-line overlay
 * outranks the profile patch the settings editor writes to.
 */
const GENERATE_BUNDLE = '@ldd/dsh-generate'
const GENERATE_PROFILE = 'web'

type ProfileManifest = {
  dsh?: {
    profile?: {
      bundles?: unknown
    }
  }
}

function manifestPath(dshHome: string): string {
  return join(dshHome, 'profiles', GENERATE_PROFILE, 'package.json')
}

async function readManifest(dshHome: string): Promise<ProfileManifest | undefined> {
  try {
    return JSON.parse(await readFile(manifestPath(dshHome), 'utf8')) as ProfileManifest
  } catch {
    return undefined
  }
}

/**
 * Ensure the web profile lists the generate bundle. Unlike dshmarket (a
 * registry package installed via `dsh plugin add`), generate ships inside the
 * LDD installer under the runtime fallback node_modules, so `resolveBundleDir`
 * finds it from the installation anchor with no profile-local install. We only
 * append the bundle id to the profile manifest; no pnpm install is needed.
 * Best-effort: a missing or uninitialized profile must never block Harness
 * startup — the market installer (or Harness init) owns profile creation, and
 * this bundle is appended on the next boot.
 */
export async function ensureGenerateBundle(
  dshHome: string,
  onDiagnostic: (line: string) => void,
): Promise<void> {
  const manifest = await readManifest(dshHome)
  if (manifest === undefined) return
  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(GENERATE_BUNDLE)) return
  onDiagnostic('正在将生成插件注册为 profile bundle…')
  await writeAtomicJson(manifestPath(dshHome), {
    ...manifest,
    dsh: {
      ...(manifest.dsh ?? {}),
      profile: {
        ...(manifest.dsh?.profile ?? {}),
        bundles: [...(Array.isArray(bundles) ? bundles : []), GENERATE_BUNDLE],
      },
    },
  })
}

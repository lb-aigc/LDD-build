import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

import type { HarnessRuntime } from '../harness/types.ts'

/**
 * The profile plugin that provides the in-app plugin center. It is a THIRD
 * PARTY npm package (`dshmarket`), not part of the LDD installer, so a fresh
 * install has no plugin center until this module installs it into the `web`
 * profile on first boot. It is installed via the Harness's own plugin command
 * (`dsh plugin --profile web add dshmarket`) so profile initialization,
 * pnpm install, and bundle reconciliation all stay in the Harness instead of
 * being re-implemented here.
 */
const MARKET_PLUGIN = 'dshmarket'
const MARKET_PROFILE = 'web'
const INSTALL_TIMEOUT_MS = 180_000

/**
 * Ensure the web profile declares the plugin-market bundle, installing it on
 * first boot when it is missing. Best-effort: a missing network or a broken
 * registry must never block Harness startup, so install failures are reported
 * through `onDiagnostic` and swallowed — the Harness boots without the center
 * and the next boot retries.
 */
export async function ensureProfileMarket(
  runtime: HarnessRuntime,
  dshHome: string,
  onDiagnostic: (line: string) => void,
): Promise<void> {
  if (await hasMarketBundle(dshHome)) return
  onDiagnostic('插件市场（dshmarket）尚未安装，正在自动安装…')
  try {
    await installMarketPlugin(runtime, dshHome, onDiagnostic)
    onDiagnostic('插件市场安装完成')
  } catch (error) {
    onDiagnostic(
      `插件市场自动安装失败（不影响启动，可稍后手动安装）：${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
}

/** Whether the web profile already lists the market bundle. A missing manifest
 *  (profile not yet initialized) counts as "not installed". */
export async function hasMarketBundle(dshHome: string): Promise<boolean> {
  const manifestPath = join(dshHome, 'profiles', MARKET_PROFILE, 'package.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) && bundles.includes(MARKET_PLUGIN)
  } catch {
    return false
  }
}

function installMarketPlugin(
  runtime: HarnessRuntime,
  dshHome: string,
  onDiagnostic: (line: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // The Harness plugin command forwards to `pnpm` (resolved on PATH), so the
    // pnpm shim directory must precede the inherited PATH. ELECTRON_RUN_AS_NODE
    // is dropped so the spawned node is a real Node, not Electron-as-node.
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: dshHome,
      PATH: [
        dirname(runtime.pnpmPath),
        dirname(runtime.nodePath),
        process.env.PATH ?? '',
      ].filter((entry) => entry.length > 0).join(delimiter),
    }
    delete environment.ELECTRON_RUN_AS_NODE
    execFile(
      runtime.nodePath,
      [runtime.dshEntryPath, 'plugin', '--profile', MARKET_PROFILE, 'add', MARKET_PLUGIN],
      {
        env: environment,
        windowsHide: true,
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (stdout.trim() !== '') onDiagnostic(stdout.trim())
        if (stderr.trim() !== '') onDiagnostic(stderr.trim())
        if (error !== null) reject(error)
        else resolve()
      },
    )
  })
}

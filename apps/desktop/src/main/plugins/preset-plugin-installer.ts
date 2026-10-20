import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

import { dialog } from 'electron'

import type { HarnessRuntime } from '../harness/types.ts'
import { PRESET_PLUGINS, type PresetPlugin } from './preset-plugins.ts'

const PRESET_PROFILE = 'web'
// git-hosted plugins (canvas) can take a while to clone; give the whole install
// a generous ceiling but keep it finite so a wedged pnpm can't hang boot forever.
const INSTALL_TIMEOUT_MS = 300_000
const DISMISSED_FILENAME = 'preset-plugins-dismissed.json'

type PromptResult = 'install' | 'skip' | 'cancel'
type RetryResult = 'skip' | 'retry' | 'skip-all'

/**
 * Offer the optional preset plugins for install on first boot, then install the
 * ones the user accepts. Best-effort: this never throws, so a missing network or
 * a broken registry can only skip plugins, never block Harness startup.
 *
 * Runs BEFORE the Harness starts (see `DesktopRuntimeController.#bootFromState`),
 * so freshly installed bundles are picked up immediately — no restart required.
 */
export async function ensurePresetPlugins(
  runtime: HarnessRuntime,
  dshHome: string,
  onDiagnostic: (line: string) => void,
): Promise<void> {
  const dismissed = await readDismissedIds(dshHome)
  const installed = await readInstalledBundles(dshHome)
  const missing = PRESET_PLUGINS.filter(
    (plugin) => !installed.has(plugin.bundleName) && !dismissed.has(plugin.id),
  )
  if (missing.length === 0) return

  const choice = await promptInstall(missing)
  if (choice === 'skip') {
    await addDismissed(dshHome, missing.map((plugin) => plugin.id))
    onDiagnostic(`已跳过 ${missing.length} 个可选插件，可稍后在「设置 → 插件」手动安装。`)
    return
  }
  if (choice === 'cancel') return

  let skipAll = false
  for (const plugin of missing) {
    if (skipAll) break
    onDiagnostic(`正在安装可选插件：${plugin.label}（${plugin.spec}）…`)
    for (;;) {
      try {
        await installPlugin(runtime, dshHome, plugin.spec, onDiagnostic)
        onDiagnostic(`可选插件安装完成：${plugin.label}`)
        break
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const action = await promptRetry(plugin, detail)
        if (action === 'skip') {
          await addDismissed(dshHome, [plugin.id])
          break
        }
        if (action === 'skip-all') {
          await addDismissed(dshHome, missing.map((item) => item.id))
          skipAll = true
          break
        }
        // 'retry' → loop again
      }
    }
  }
}

function installPlugin(
  runtime: HarnessRuntime,
  dshHome: string,
  spec: string,
  onDiagnostic: (line: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // The Harness plugin command forwards to pnpm (resolved on PATH), so the
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
      [runtime.dshEntryPath, 'plugin', '--profile', PRESET_PROFILE, 'add', spec],
      {
        env: environment,
        windowsHide: true,
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
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

async function promptInstall(missing: readonly PresetPlugin[]): Promise<PromptResult> {
  const detail = missing.map((plugin) => `· ${plugin.label}（${plugin.bundleName}）`).join('\n')
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: '安装可选插件',
    message: `检测到 ${missing.length} 个可选插件未安装，是否现在安装？`,
    detail,
    buttons: ['安装', '跳过', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  return (['install', 'skip', 'cancel'] as const)[response] ?? 'cancel'
}

async function promptRetry(plugin: PresetPlugin, detail: string): Promise<RetryResult> {
  const trimmed = detail.length > 600 ? `${detail.slice(0, 600)}…` : detail
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: '插件安装失败',
    message: `网络问题，无法安装「${plugin.label}」，是否跳过？`,
    detail: trimmed,
    buttons: ['跳过此插件', '重试', '跳过全部'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return (['skip', 'retry', 'skip-all'] as const)[response] ?? 'skip'
}

async function readInstalledBundles(dshHome: string): Promise<Set<string>> {
  const manifestPath = join(dshHome, 'profiles', PRESET_PROFILE, 'package.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = manifest.dsh?.profile?.bundles
    return new Set(
      Array.isArray(bundles) ? bundles.filter((x): x is string => typeof x === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

async function readDismissedIds(dshHome: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(dshHome, DISMISSED_FILENAME), 'utf8')
    const parsed = JSON.parse(raw) as { ids?: unknown }
    return new Set(
      Array.isArray(parsed.ids) ? parsed.ids.filter((x): x is string => typeof x === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

async function addDismissed(dshHome: string, ids: readonly string[]): Promise<void> {
  const current = await readDismissedIds(dshHome)
  for (const id of ids) current.add(id)
  await writeFile(
    join(dshHome, DISMISSED_FILENAME),
    `${JSON.stringify({ ids: [...current].sort() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  ).catch(() => undefined)
}

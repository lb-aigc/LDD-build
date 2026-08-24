import { execFile } from 'node:child_process'
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { verifyRuntimeMetadata } from '@ldd/runtime-package'
import { sha256File } from '@ldd/runtime-kit/checksum'
import { compareRuntimeNames } from '@ldd/runtime-kit/runtime-manifest'

import type { BootResult, DesktopRuntimePort } from '../index.ts'
import type { RuntimeProgressEvent, RuntimeStatusView } from '../ipc/contracts.ts'
import type { LddPaths } from '../paths.ts'
import { writeManagedImagePatch } from '../profile/write-managed-patch.ts'
import { createVersionBackup } from '../migration/backup.ts'
import { copyInventory, inventoryTree, verifyInventory } from '../migration/inventory.ts'
import { readLddSettings, writeLddSettings } from '../settings.ts'
import { HarnessSupervisor } from '../harness/supervisor.ts'
import type { HarnessRuntime, HarnessStartOptions } from '../harness/types.ts'
import { parseRuntimeManifest, type RuntimeManifest } from './manifest.ts'
import { RuntimeInstaller, type InstalledRuntime } from './installer.ts'
import {
  runTwoPhaseCandidateHealth,
  type CandidateHealthEvidence,
  type CandidateHealthPhase,
  type CandidateHealthProcess,
} from './health.ts'
import { installOnlineRuntime } from './online-install.ts'
import { runtimeArchiveLimits } from './limits.ts'
import { RegistryClient, type ResolvedRuntimeRelease } from './registry.ts'
import { selectRuntime, type RuntimeCandidate, type RuntimeInventory } from './select.ts'
import { assertSemanticVersion, compareSemanticVersions } from './semver.ts'
import { readRuntimeState, writeRuntimeState, type RuntimeState } from './state.ts'
import { RuntimeUpdater } from './updater.ts'

export interface DesktopRuntimeControllerOptions {
  readonly paths: LddPaths
  readonly desktopVersion: string
  readonly onProgress?: (event: RuntimeProgressEvent) => void | Promise<void>
}

export class DesktopRuntimeController implements DesktopRuntimePort {
  readonly #options: DesktopRuntimeControllerOptions
  readonly #supervisor = new HarnessSupervisor()
  readonly #registry = new RegistryClient()
  readonly #updater: RuntimeUpdater
  readonly #installer: RuntimeInstaller
  #availableRelease: ResolvedRuntimeRelease | null = null
  #diagnostics: string[] = []

  constructor(options: DesktopRuntimeControllerOptions) {
    this.#options = options
    this.#updater = new RuntimeUpdater({ statePath: options.paths.statePath, registry: this.#registry })
    this.#installer = new RuntimeInstaller({
      statePath: options.paths.statePath,
      stagingRoot: options.paths.stagingRoot,
      versionsRoot: options.paths.versionsRoot,
      lifecycle: {
        stopCurrent: () => this.#supervisor.stop(),
        startCandidate: async (runtime) => this.#startInstalled(runtime),
        restorePrevious: async (state) => {
          const restored = await this.#bootFromState(state)
          if (restored.kind === 'failure') throw new Error(restored.diagnostics.join('\n'))
        },
      },
      beforeActivate: async (runtime) => {
        await createVersionBackup(options.paths.dshHome, options.paths.backupsRoot, runtime.version)
      },
      onProgress: async (state) => this.#progress(state, null, `内核事务：${state}`),
    })
  }

  async boot(): Promise<BootResult> {
    if (this.#supervisor.current !== null) return { kind: 'ready', url: this.#supervisor.current.url }
    const read = await readRuntimeState(this.#options.paths.statePath)
    this.#diagnostics = read.diagnostics.map((item) => item.message)
    if (read.state.pendingVersion !== null) {
      this.#diagnostics.push(`检测到未完成的内核切换：${read.state.pendingVersion}，已使用已提交状态启动。`)
    }
    return await this.#bootFromState(read.state)
  }

  async getStatus(): Promise<RuntimeStatusView> {
    const [state, settings] = await Promise.all([
      readRuntimeState(this.#options.paths.statePath),
      readLddSettings(this.#options.paths.settingsPath),
    ])
    const fallback = state.state.activeVersion === null
      ? null
      : await inspectFallback(this.#options.paths.fallbackRoot)
    return {
      desktopVersion: this.#options.desktopVersion,
      activeVersion: this.#supervisor.current?.runtimeVersion ?? state.state.activeVersion,
      lastKnownGoodVersion: state.state.lastKnownGoodVersion ??
        (fallback?.valid === true ? `${fallback.version} (Fallback)` : null),
      availableVersion: this.#availableRelease?.version ?? null,
      channel: state.state.channel,
      imageMode: settings.imageMode,
      diagnostics: [...this.#diagnostics, ...state.diagnostics.map((item) => item.message)],
    }
  }

  async checkForUpdates(manual = true): Promise<unknown> {
    const current = await this.#currentVersion()
    const result = await this.#updater.checkForUpdates(current, manual)
    this.#availableRelease = result.kind === 'available' ? result.release : null
    return result
  }

  async downloadUpdate(version: string): Promise<unknown> {
    assertSemanticVersion(version)
    let release = this.#availableRelease
    if (release?.version !== version) {
      const state = (await readRuntimeState(this.#options.paths.statePath)).state
      release = await this.#registry.resolve(state.channel, await this.#currentVersion())
    }
    if (release?.version !== version) throw new Error(`官方更新源没有提供 Harness ${version}`)
    const pluginArchivePaths = requiredLddPlugins.map((name) => join(
      this.#options.paths.fallbackRoot,
      'plugins',
      '@ldd',
      `${name.slice('@ldd/'.length)}.tgz`,
    ))
    const installed = await installOnlineRuntime({
      release,
      stagingRoot: this.#options.paths.stagingRoot,
      versionsRoot: this.#options.paths.versionsRoot,
      host: {
        nodePath: join(this.#options.paths.runtimeHostRoot, 'node', 'node.exe'),
        pnpmPath: join(this.#options.paths.runtimeHostRoot, 'pnpm', 'bin', 'pnpm.cjs'),
        pluginArchivePaths,
      },
      createdAt: new Date().toISOString(),
      desktopVersion: this.#options.desktopVersion,
      onProgress: (event) => this.#options.onProgress?.(event),
    })
    return { kind: 'installed', version: installed.version }
  }

  async activateVersion(version: string): Promise<BootResult> {
    assertSemanticVersion(version)
    const candidatePath = join(this.#options.paths.versionsRoot, version)
    await assertVerifiedRuntime(candidatePath)
    const manifest = await readManifest(candidatePath)
    if (manifest.harnessVersion !== version) throw new Error('候选内核目录与清单版本不一致')
    await this.#runCandidateHealth({ version, path: candidatePath, manifest })
    await this.#installer.activate(version, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
      if (this.#supervisor.current?.runtimeVersion !== version) {
        throw new Error('候选内核未保持就绪状态')
      }
    })
    this.#availableRelease = null
    return { kind: 'ready', url: this.#requireCurrentUrl() }
  }

  async importOfflineRuntime(archivePath: string): Promise<unknown> {
    const installed = await this.#installer.install({ archivePath, limits: runtimeArchiveLimits }, async (candidate) => {
      if (compareSemanticVersions(this.#options.desktopVersion, candidate.manifest.minimumLddVersion) < 0) {
        throw new Error(`该内核包需要 LDD ${candidate.manifest.minimumLddVersion} 或更高版本`)
      }
      assertRequiredPlugin(candidate.manifest)
      await assertRuntimeEntry(candidate.stagingPath)
    })
    return { kind: 'installed', version: installed.version }
  }

  async rollback(): Promise<BootResult> {
    const state = (await readRuntimeState(this.#options.paths.statePath)).state
    if (state.lastKnownGoodVersion !== null && state.lastKnownGoodVersion !== state.activeVersion) {
      return await this.activateVersion(state.lastKnownGoodVersion)
    }
    if (state.activeVersion !== null) return await this.#activateFallback(state)
    throw new Error('没有可回滚的上一内核版本')
  }

  async setImageMode(mode: 'standard' | 'large'): Promise<unknown> {
    const current = await readLddSettings(this.#options.paths.settingsPath)
    await writeLddSettings(this.#options.paths.settingsPath, { ...current, imageMode: mode })
    await writeManagedImagePatch(this.#options.paths.dshHome, mode)
    if (this.#supervisor.current !== null) {
      await this.#supervisor.stop()
      const result = await this.boot()
      if (result.kind === 'failure') throw new Error(result.diagnostics.join('\n'))
    }
    return { kind: 'updated', imageMode: mode }
  }

  async disposeUpdater(): Promise<void> {}

  async stopHarness(): Promise<void> {
    await this.#supervisor.stop()
  }

  async probeHarnessHome(candidateHome: string): Promise<{ readonly compatible: true } | {
    readonly compatible: false
    readonly reason: string
  }> {
    const supervisor = new HarnessSupervisor()
    try {
      const read = await readRuntimeState(this.#options.paths.statePath)
      const selection = selectRuntime(read.state, await this.#inventory())
      if (selection.kind === 'failure') {
        return { compatible: false, reason: selection.reasons.join('\n') }
      }
      await assertVerifiedRuntime(selection.path)
      const settings = await readLddSettings(this.#options.paths.settingsPath)
      const managedPatchPath = await writeManagedImagePatch(candidateHome, settings.imageMode)
      await supervisor.start(
        toHarnessRuntime(selection.path, selection.version, this.#options.paths.runtimeHostRoot),
        await this.#startOptions(candidateHome, managedPatchPath),
      )
      return { compatible: true }
    } catch (error) {
      return {
        compatible: false,
        reason: error instanceof Error ? error.message : 'Harness 数据兼容性验证失败',
      }
    } finally {
      await supervisor.stop().catch(() => undefined)
    }
  }

  async #bootFromState(state: RuntimeState): Promise<BootResult> {
    const inventory = await this.#inventory()
    const selection = selectRuntime(state, inventory)
    if (selection.kind === 'failure') {
      return { kind: 'failure', diagnostics: [...this.#diagnostics, ...selection.reasons] }
    }
    this.#diagnostics.push(...selection.reasons)
    try {
      await assertVerifiedRuntime(selection.path)
      const runtime = toHarnessRuntime(
        selection.path,
        selection.version,
        this.#options.paths.runtimeHostRoot,
      )
      const handle = await this.#supervisor.start(runtime, await this.#startOptions())
      return { kind: 'ready', url: handle.url }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Harness 启动失败'
      await this.#log(message)
      return { kind: 'failure', diagnostics: [...this.#diagnostics, message] }
    }
  }

  async #startInstalled(runtime: InstalledRuntime) {
    await assertVerifiedRuntime(runtime.path)
    return await this.#supervisor.start(
      toHarnessRuntime(runtime.path, runtime.version, this.#options.paths.runtimeHostRoot),
      await this.#startOptions(),
    )
  }

  async #runCandidateHealth(runtime: InstalledRuntime): Promise<void> {
    await mkdir(this.#options.paths.stagingRoot, { mode: 0o700, recursive: true })
    const probeRoot = await mkdtemp(join(this.#options.paths.stagingRoot, '.candidate-health-'))
    const freshHome = join(probeRoot, 'fresh')
    const profileCopyHome = join(probeRoot, 'profile-copy')
    try {
      await mkdir(freshHome, { mode: 0o700 })
      const inventory = await inventoryTree(this.#options.paths.dshHome)
      await copyInventory(this.#options.paths.dshHome, profileCopyHome, inventory)
      await verifyInventory(profileCopyHome, inventory)
      const result = await runTwoPhaseCandidateHealth(
        runtime,
        { freshHome, profileCopyHome },
        {
          checkCliVersion: async (candidate) => await readCandidateCliVersion(
            toHarnessRuntime(candidate.path, candidate.version, this.#options.paths.runtimeHostRoot),
          ),
          start: async (candidate, phase) => await this.#startHealthCandidate(candidate, phase),
        },
      )
      if (result.kind === 'incompatible-plugins') {
        throw new Error(`候选内核与以下插件不兼容：${result.incompatiblePlugins.join('、')}`)
      }
    } finally {
      await rm(probeRoot, { recursive: true, force: true })
    }
  }

  async #startHealthCandidate(
    runtime: { readonly version: string; readonly path: string },
    phase: CandidateHealthPhase,
  ): Promise<CandidateHealthProcess> {
    const supervisor = new HarnessSupervisor()
    const managedPatchPath = await writeManagedImagePatch(
      phase.dshHome,
      (await readLddSettings(this.#options.paths.settingsPath)).imageMode,
    )
    const handle = await supervisor.start(
      toHarnessRuntime(runtime.path, runtime.version, this.#options.paths.runtimeHostRoot),
      await this.#startOptions(phase.dshHome, managedPatchPath),
    )
    return {
      inspect: async () => await inspectCandidateHealth(handle.url, runtime.version, phase.dshHome),
      stop: async () => await supervisor.stop(),
      isQuiescent: async () => supervisor.current === null,
    }
  }

  async #activateFallback(before: RuntimeState): Promise<BootResult> {
    const fallback = await inspectFallback(this.#options.paths.fallbackRoot)
    if (!fallback.valid) throw new Error(`Fallback 不可用：${fallback.reason}`)
    await assertVerifiedRuntime(fallback.path)
    await createVersionBackup(
      this.#options.paths.dshHome,
      this.#options.paths.backupsRoot,
      fallback.version,
    )
    await this.#supervisor.stop()
    try {
      const handle = await this.#supervisor.start(
        toHarnessRuntime(fallback.path, fallback.version, this.#options.paths.runtimeHostRoot),
        await this.#startOptions(),
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
      if (this.#supervisor.current !== handle) throw new Error('Fallback 未保持就绪状态')
      await writeRuntimeState(this.#options.paths.statePath, {
        ...before,
        activeVersion: null,
        lastKnownGoodVersion: before.activeVersion,
        pendingVersion: null,
      })
      return { kind: 'ready', url: handle.url }
    } catch (error) {
      await this.#supervisor.stop().catch(() => undefined)
      const restored = await this.#bootFromState(before)
      if (restored.kind === 'failure') {
        throw new AggregateError([error, new Error(restored.diagnostics.join('\n'))], 'Fallback 回滚失败')
      }
      throw error
    }
  }

  async #startOptions(
    dshHome = this.#options.paths.dshHome,
    managedPatchPath?: string,
  ): Promise<HarnessStartOptions> {
    const settings = await readLddSettings(this.#options.paths.settingsPath)
    const resolvedPatchPath = managedPatchPath ?? await writeManagedImagePatch(dshHome, settings.imageMode)
    return {
      dshHome,
      imageMode: settings.imageMode,
      managedPatchPath: resolvedPatchPath,
      preferredPort: 3080,
      startupTimeoutMs: 45_000,
      stopGraceMs: 5_000,
      forceStopMs: 5_000,
      environment: {},
      onDiagnostic: (line) => { void this.#log(line) },
    }
  }

  async #inventory(): Promise<RuntimeInventory> {
    const external = new Map<string, RuntimeCandidate>()
    for (const name of await safeReadDirectory(this.#options.paths.versionsRoot)) {
      const path = join(this.#options.paths.versionsRoot, name)
      external.set(name, await inspectRuntimeCandidate(path, name))
    }
    const fallback = await inspectFallback(this.#options.paths.fallbackRoot)
    return { external, fallback }
  }

  async #currentVersion(): Promise<string> {
    if (this.#supervisor.current !== null) return this.#supervisor.current.runtimeVersion
    const fallback = await inspectFallback(this.#options.paths.fallbackRoot)
    const state = (await readRuntimeState(this.#options.paths.statePath)).state
    return state.activeVersion ?? fallback?.version ?? '0.1.1-rc.2'
  }

  #requireCurrentUrl(): string {
    const current = this.#supervisor.current
    if (current === null) throw new Error('Harness candidate is not running')
    return current.url
  }

  async #progress(phase: string, percent: number | null, message: string): Promise<void> {
    await this.#options.onProgress?.({ phase, percent, message })
  }

  async #log(message: string): Promise<void> {
    await appendFile(
      join(this.#options.paths.logsRoot, 'ldd-runtime.log'),
      `${new Date().toISOString()} ${message}\n`,
      { encoding: 'utf8', mode: 0o600 },
    ).catch(() => undefined)
  }
}

function toHarnessRuntime(path: string, version: string, hostRoot: string): HarnessRuntime {
  return {
    version,
    rootPath: path,
    nodePath: join(hostRoot, 'node', 'node.exe'),
    dshEntryPath: join(path, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    pnpmPath: join(hostRoot, 'pnpm', 'bin', 'pnpm.cjs'),
    ffmpegPath: join(hostRoot, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ffprobePath: join(hostRoot, 'ffmpeg', 'bin', 'ffprobe.exe'),
  }
}

async function inspectRuntimeCandidate(path: string, version: string): Promise<RuntimeCandidate> {
  try {
    const manifest = await readManifest(path)
    if (manifest.harnessVersion !== version) return { path, valid: false, reason: '清单版本与目录不一致' }
    assertRequiredPlugin(manifest)
    await assertRuntimeEntry(path)
    return { path, valid: true }
  } catch (error) {
    return { path, valid: false, reason: error instanceof Error ? error.message : '清单校验失败' }
  }
}

async function inspectFallback(path: string) {
  try {
    const manifest = await readManifest(path)
    assertRequiredPlugin(manifest)
    await assertRuntimeEntry(path)
    return { path, version: manifest.harnessVersion, valid: true as const }
  } catch (error) {
    return {
      path,
      version: '0.1.1-rc.2',
      valid: false as const,
      reason: error instanceof Error ? error.message : 'Fallback 校验失败',
    }
  }
}

async function readManifest(path: string): Promise<RuntimeManifest> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('运行包目录无效')
  return parseRuntimeManifest(JSON.parse(await readFile(join(path, 'runtime.json'), 'utf8')) as unknown)
}

async function assertRuntimeEntry(path: string): Promise<void> {
  const entry = join(path, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const metadata = await lstat(entry)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('运行包缺少 dsh 入口')
  const manifest = await readManifest(path)
  for (const plugin of manifest.plugins) {
    const archive = join(path, 'plugins', '@ldd', `${plugin.name.slice('@ldd/'.length)}.tgz`)
    if (await sha256File(archive) !== plugin.sha256) throw new Error(`LDD 插件校验失败：${plugin.name}`)
  }
}

const requiredLddPlugins = ['@ldd/dsh-video-frame-analyzer', '@ldd/dsh-generate'] as const

function assertRequiredPlugin(manifest: RuntimeManifest): void {
  for (const required of requiredLddPlugins) {
    if (!manifest.plugins.some((item) => item.name === required)) {
      throw new Error(`运行包缺少 LDD 插件：${required}`)
    }
  }
}

async function assertVerifiedRuntime(path: string): Promise<void> {
  await verifyRuntimeMetadata(path)
  await assertRuntimeEntry(path)
}

async function safeReadDirectory(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path)).sort(compareRuntimeNames)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

async function readCandidateCliVersion(runtime: HarnessRuntime): Promise<string> {
  return await new Promise<string>((resolveVersion, reject) => {
    execFile(
      runtime.nodePath,
      [runtime.dshEntryPath, '--version'],
      {
        cwd: runtime.rootPath,
        encoding: 'utf8',
        env: candidateProbeEnvironment(),
        maxBuffer: 64 * 1024,
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) reject(error)
        else resolveVersion(stdout.trim())
      },
    )
  })
}

async function inspectCandidateHealth(
  baseUrl: string,
  expectedVersion: string,
  expectedHome: string,
): Promise<CandidateHealthEvidence> {
  const url = new URL(baseUrl)
  const root = await boundedFetchText(new URL('/', url), { headers: { accept: 'text/html' } })
  const health = requireRecord(JSON.parse(await boundedFetchText(new URL('/__ldd/health', url), {
    headers: { accept: 'application/json' },
  })) as unknown, 'LDD plugin health')
  const host = requireRecord(await callHarnessRpc(url, 'host.describe', {}), 'host.describe')
  const models = requireRecord(await callHarnessRpc(url, 'llm.models', {}), 'llm.models')
  const session = requireRecord(await callHarnessRpc(url, 'session.create', { cwd: expectedHome }), 'session.create')
  if (typeof session.sessionId !== 'string') throw new Error('candidate session.create returned no sessionId')
  const skills = requireRecord(await callHarnessRpc(
    url,
    'skill.list',
    { sessionId: session.sessionId },
  ), 'skill.list')

  const modelIds = collectModelIds(models.groups)
  const skillNames = collectNamedEntries(skills.skills)
  const healthOk = health.product === 'LDD-Harness' &&
    health.videoToolRegistered === true &&
    health.sessionEventTypeRegistered === true &&
    health.skill === 'video-analysis'
  return {
    boundHost: url.hostname,
    webRootOk: root.length > 0,
    apiManifestOk: host.version === expectedVersion && host.home === expectedHome,
    textModelDeclared: modelIds.has('deepseek-v4-flash'),
    visionModelDeclared: modelIds.has('deepseek-v4-flash-vision-exp'),
    videoToolRegistered: healthOk,
    pluginListOk: healthOk && skillNames.has('video-analysis'),
    incompatiblePlugins: [],
  }
}

async function callHarnessRpc(
  baseUrl: URL,
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const rpcId = `ldd-health-${method}-${Date.now().toString(36)}`
  const serialized = await boundedFetchText(new URL(`/api/${method}`, baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const response = requireRecord(JSON.parse(serialized) as unknown, `${method} response`)
  if (response.type !== 'server-response' || response.rpcId !== rpcId) {
    throw new Error(`candidate ${method} returned a mismatched RPC envelope`)
  }
  const result = requireRecord(response.result, `${method} result`)
  if (result.ok !== true) {
    const error = typeof result.error === 'object' && result.error !== null
      ? JSON.stringify(result.error).slice(0, 2_000)
      : 'unknown error'
    throw new Error(`candidate ${method} failed: ${error}`)
  }
  return result.value
}

async function boundedFetchText(url: URL, init: RequestInit): Promise<string> {
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')) {
    throw new Error('candidate health requests are restricted to loopback HTTP')
  }
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`candidate health request ${url.pathname} returned HTTP ${response.status}`)
  if (response.body === null) throw new Error(`candidate health response ${url.pathname} has no body`)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 2 * 1024 * 1024) {
      throw new Error(`candidate health response ${url.pathname} exceeds 2 MiB`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

function collectModelIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error('candidate llm.models groups are invalid')
  const ids = new Set<string>()
  for (const group of value) {
    const record = requireRecord(group, 'candidate model group')
    if (!Array.isArray(record.models)) throw new Error('candidate model group has no models')
    for (const model of record.models) {
      const item = requireRecord(model, 'candidate model')
      if (typeof item.id === 'string') ids.add(item.id)
    }
  }
  return ids
}

function collectNamedEntries(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error('candidate named entry list is invalid')
  const names = new Set<string>()
  for (const entry of value) {
    const record = requireRecord(entry, 'candidate named entry')
    if (typeof record.name === 'string') names.add(record.name)
  }
  return names
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} is not an object`)
  }
  return value as Record<string, unknown>
}

function candidateProbeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

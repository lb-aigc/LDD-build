import type { ImageMode } from '../profile/image-mode.ts'

export const rendererApiKeys = [
  'getStatus',
  'checkForUpdates',
  'downloadUpdate',
  'activateVersion',
  'importOfflineRuntime',
  'rollback',
  'setImageMode',
  'openPluginCenter',
  'retryBoot',
  'openLogDirectory',
  'subscribeProgress',
] as const

export type RendererApiKey = (typeof rendererApiKeys)[number]
export type InvokeApiKey = Exclude<RendererApiKey, 'subscribeProgress'>

export const ipcChannels: Readonly<Record<RendererApiKey, string>> = Object.freeze({
  getStatus: 'ldd:status:get',
  checkForUpdates: 'ldd:update:check',
  downloadUpdate: 'ldd:update:download',
  activateVersion: 'ldd:runtime:activate',
  importOfflineRuntime: 'ldd:runtime:import-offline',
  rollback: 'ldd:runtime:rollback',
  setImageMode: 'ldd:settings:image-mode',
  openPluginCenter: 'ldd:plugins:open-center',
  retryBoot: 'ldd:boot:retry',
  openLogDirectory: 'ldd:logs:open',
  subscribeProgress: 'ldd:progress',
})

export interface RuntimeStatusView {
  readonly desktopVersion: string
  readonly activeVersion: string | null
  readonly lastKnownGoodVersion: string | null
  readonly availableVersion: string | null
  readonly channel: 'stable' | 'prerelease'
  readonly imageMode: ImageMode
  readonly diagnostics: readonly string[]
}

export interface RuntimeProgressEvent {
  readonly phase: string
  readonly percent: number | null
  readonly message: string
}

export interface LddRendererApi {
  getStatus(): Promise<RuntimeStatusView>
  checkForUpdates(): Promise<unknown>
  downloadUpdate(version: string): Promise<unknown>
  activateVersion(version: string): Promise<unknown>
  importOfflineRuntime(): Promise<unknown>
  rollback(): Promise<unknown>
  setImageMode(mode: ImageMode): Promise<unknown>
  openPluginCenter(): Promise<void>
  retryBoot(): Promise<unknown>
  openLogDirectory(): Promise<void>
  subscribeProgress(listener: (event: RuntimeProgressEvent) => void): () => void
}

export type IpcRequest =
  | { readonly method: 'getStatus'; readonly value: undefined }
  | { readonly method: 'checkForUpdates'; readonly value: undefined }
  | { readonly method: 'downloadUpdate'; readonly value: { readonly version: string } }
  | { readonly method: 'activateVersion'; readonly value: { readonly version: string } }
  | { readonly method: 'importOfflineRuntime'; readonly value: undefined }
  | { readonly method: 'rollback'; readonly value: undefined }
  | { readonly method: 'setImageMode'; readonly value: { readonly mode: ImageMode } }
  | { readonly method: 'openPluginCenter'; readonly value: undefined }
  | { readonly method: 'retryBoot'; readonly value: undefined }
  | { readonly method: 'openLogDirectory'; readonly value: undefined }

export function parseIpcRequest(method: InvokeApiKey, value: unknown): IpcRequest {
  switch (method) {
    case 'getStatus':
    case 'checkForUpdates':
    case 'importOfflineRuntime':
    case 'rollback':
    case 'openPluginCenter':
    case 'retryBoot':
    case 'openLogDirectory':
      requireNoInput(method, value)
      return { method, value: undefined }
    case 'downloadUpdate':
    case 'activateVersion':
      return { method, value: parseVersionInput(value) }
    case 'setImageMode':
      return { method, value: parseImageModeInput(value) }
  }
}

export function parseRuntimeProgress(value: unknown): RuntimeProgressEvent {
  const record = requireExactRecord(value, 'progress event', ['phase', 'percent', 'message'])
  if (typeof record.phase !== 'string' || record.phase.length === 0 || record.phase.length > 128) {
    throw new TypeError('progress phase is invalid')
  }
  if (
    record.percent !== null &&
    (typeof record.percent !== 'number' ||
      !Number.isFinite(record.percent) ||
      record.percent < 0 ||
      record.percent > 100)
  ) {
    throw new TypeError('progress percent must be null or between 0 and 100')
  }
  if (typeof record.message !== 'string' || record.message.length > 4_096) {
    throw new TypeError('progress message is invalid')
  }
  return {
    phase: record.phase,
    percent: record.percent as number | null,
    message: record.message,
  }
}

function requireNoInput(method: string, value: unknown): void {
  if (value !== undefined) {
    throw new TypeError(`${method} accepts no input`)
  }
}

function parseVersionInput(value: unknown): { readonly version: string } {
  const record = requireExactRecord(value, 'version request', ['version'])
  if (
    typeof record.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      record.version,
    )
  ) {
    throw new TypeError('version request must contain one semantic version')
  }
  return { version: record.version }
}

function parseImageModeInput(value: unknown): { readonly mode: ImageMode } {
  const record = requireExactRecord(value, 'image-mode request', ['mode'])
  if (record.mode !== 'standard' && record.mode !== 'large') {
    throw new TypeError('image mode must be standard or large')
  }
  return { mode: record.mode }
}

function requireExactRecord(
  value: unknown,
  field: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  const record = value as Record<string, unknown>
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${field} contains unexpected field ${key}`)
    }
  }
  return record
}

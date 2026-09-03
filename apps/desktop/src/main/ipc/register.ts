import {
  ipcChannels,
  parseIpcRequest,
  type ImportFileResult,
  type RuntimeProgressEvent,
  type RuntimeStatusView,
} from './contracts.ts'

export interface IpcMainLike {
  handle(channel: string, listener: (_event: unknown, input?: unknown) => unknown): void
  removeHandler(channel: string): void
}

export interface DesktopIpcServices {
  getStatus(): Promise<RuntimeStatusView>
  checkForUpdates(): Promise<unknown>
  downloadUpdate(version: string): Promise<unknown>
  activateVersion(version: string): Promise<unknown>
  importOfflineRuntime(): Promise<unknown>
  rollback(): Promise<unknown>
  setImageMode(mode: 'standard' | 'large'): Promise<unknown>
  getDataDirectory(): Promise<{ dataDirectory: string | null }>
  setDataDirectory(): Promise<{ dataDirectory: string; cancelled: false } | { cancelled: true }>
  openPluginCenter(): Promise<void>
  retryBoot(): Promise<unknown>
  openLogDirectory(): Promise<void>
  saveImage(data: ArrayBuffer, defaultName: string): Promise<{ saved: boolean; path?: string }>
  saveAudio(data: ArrayBuffer, defaultName: string): Promise<{ saved: boolean; path?: string }>
  importFile(data: ArrayBuffer, fileName: string, workspacePath: string): Promise<ImportFileResult>
}

export function registerDesktopIpc(
  ipcMain: IpcMainLike,
  services: DesktopIpcServices,
): () => void {
  register(ipcMain, 'getStatus', async () => services.getStatus())
  register(ipcMain, 'checkForUpdates', async () => services.checkForUpdates())
  register(ipcMain, 'downloadUpdate', async (input) =>
    services.downloadUpdate((input.value as { version: string }).version),
  )
  register(ipcMain, 'activateVersion', async (input) =>
    services.activateVersion((input.value as { version: string }).version),
  )
  register(ipcMain, 'importOfflineRuntime', async () => services.importOfflineRuntime())
  register(ipcMain, 'rollback', async () => services.rollback())
  register(ipcMain, 'setImageMode', async (input) =>
    services.setImageMode((input.value as { mode: 'standard' | 'large' }).mode),
  )
  register(ipcMain, 'getDataDirectory', async () => services.getDataDirectory())
  register(ipcMain, 'setDataDirectory', async () => services.setDataDirectory())
  register(ipcMain, 'openPluginCenter', async () => services.openPluginCenter())
  register(ipcMain, 'retryBoot', async () => services.retryBoot())
  register(ipcMain, 'openLogDirectory', async () => services.openLogDirectory())
  register(ipcMain, 'saveImage', async (input) =>
    services.saveImage(
      (input.value as { data: ArrayBuffer; defaultName: string }).data,
      (input.value as { data: ArrayBuffer; defaultName: string }).defaultName,
    ),
  )
  register(ipcMain, 'saveAudio', async (input) =>
    services.saveAudio(
      (input.value as { data: ArrayBuffer; defaultName: string }).data,
      (input.value as { data: ArrayBuffer; defaultName: string }).defaultName,
    ),
  )
  register(ipcMain, 'importFile', async (input) => {
    const value = input.value as { data: ArrayBuffer; fileName: string; workspacePath: string }
    return services.importFile(value.data, value.fileName, value.workspacePath)
  })

  return () => {
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.subscribeProgress) ipcMain.removeHandler(channel)
    }
  }
}

export function publishRuntimeProgress(
  targets: readonly { send(channel: string, event: RuntimeProgressEvent): void }[],
  event: RuntimeProgressEvent,
): void {
  for (const target of targets) target.send(ipcChannels.subscribeProgress, event)
}

function register(
  ipcMain: IpcMainLike,
  method:
    | 'getStatus'
    | 'checkForUpdates'
    | 'downloadUpdate'
    | 'activateVersion'
    | 'importOfflineRuntime'
    | 'rollback'
    | 'setImageMode'
    | 'getDataDirectory'
    | 'setDataDirectory'
    | 'openPluginCenter'
    | 'retryBoot'
    | 'openLogDirectory'
    | 'saveImage'
    | 'saveAudio'
    | 'importFile',
  invoke: (input: ReturnType<typeof parseIpcRequest>) => Promise<unknown>,
): void {
  ipcMain.handle(ipcChannels[method], async (_event, value) => {
    const parsed = parseIpcRequest(method, value)
    return await invoke(parsed)
  })
}

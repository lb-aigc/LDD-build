import {
  ipcChannels,
  parseIpcRequest,
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
  openPluginCenter(): Promise<void>
  retryBoot(): Promise<unknown>
  openLogDirectory(): Promise<void>
  saveImage(data: ArrayBuffer, defaultName: string): Promise<{ saved: boolean; path?: string }>
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
  register(ipcMain, 'openPluginCenter', async () => services.openPluginCenter())
  register(ipcMain, 'retryBoot', async () => services.retryBoot())
  register(ipcMain, 'openLogDirectory', async () => services.openLogDirectory())
  register(ipcMain, 'saveImage', async (input) =>
    services.saveImage(
      (input.value as { data: ArrayBuffer; defaultName: string }).data,
      (input.value as { data: ArrayBuffer; defaultName: string }).defaultName,
    ),
  )

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
    | 'openPluginCenter'
    | 'retryBoot'
    | 'openLogDirectory'
    | 'saveImage',
  invoke: (input: ReturnType<typeof parseIpcRequest>) => Promise<unknown>,
): void {
  ipcMain.handle(ipcChannels[method], async (_event, value) => {
    const parsed = parseIpcRequest(method, value)
    return await invoke(parsed)
  })
}

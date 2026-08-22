import { contextBridge, ipcRenderer } from 'electron'
import {
  ipcChannels,
  parseRuntimeProgress,
  type LddRendererApi,
  type RuntimeProgressEvent,
  type RuntimeStatusView,
} from '../main/ipc/contracts.ts'

const api: LddRendererApi = {
  getStatus: async () => ipcRenderer.invoke(ipcChannels.getStatus) as Promise<RuntimeStatusView>,
  checkForUpdates: async () => ipcRenderer.invoke(ipcChannels.checkForUpdates),
  downloadUpdate: async (version) =>
    ipcRenderer.invoke(ipcChannels.downloadUpdate, { version }),
  activateVersion: async (version) =>
    ipcRenderer.invoke(ipcChannels.activateVersion, { version }),
  importOfflineRuntime: async () => ipcRenderer.invoke(ipcChannels.importOfflineRuntime),
  rollback: async () => ipcRenderer.invoke(ipcChannels.rollback),
  setImageMode: async (mode) => ipcRenderer.invoke(ipcChannels.setImageMode, { mode }),
  openPluginCenter: async () => ipcRenderer.invoke(ipcChannels.openPluginCenter),
  retryBoot: async () => ipcRenderer.invoke(ipcChannels.retryBoot),
  openLogDirectory: async () => ipcRenderer.invoke(ipcChannels.openLogDirectory),
  subscribeProgress: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(parseRuntimeProgress(value))
    }
    ipcRenderer.on(ipcChannels.subscribeProgress, receive)
    return () => ipcRenderer.removeListener(ipcChannels.subscribeProgress, receive)
  },
}

contextBridge.exposeInMainWorld('ldd', Object.freeze(api))

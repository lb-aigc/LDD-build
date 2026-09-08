/**
 * Minimal preload for the preview panel's own WebContentsView. Unlike the
 * main window preload, this one exposes NOTHING beyond `closePreview`: the
 * panel loads arbitrary remote pages (built-in browser), so it must never see
 * the management surface (setDataDirectory, saveImage, …). Only the close
 * gesture crosses the bridge, over the same `ldd:preview:close` channel.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels } from '../main/ipc/contracts.ts'

contextBridge.exposeInMainWorld('lddPreview', Object.freeze({
  close: (): Promise<void> => ipcRenderer.invoke(ipcChannels.closePreview) as Promise<void>,
}))

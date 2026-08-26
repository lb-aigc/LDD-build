import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron'

import type { RuntimeStatusView } from './ipc/contracts.ts'
import { registerDesktopIpc } from './ipc/register.ts'
import { importWorkspaceFile } from './import-file.ts'
import { createCompleteExit, createWindowCloseHandler, type ExitState } from './lifecycle.ts'
import { createEditMenu, createFileMenu, createHelpMenu } from './menu.ts'
import { GLASS_THEME_CSS } from './glass-theme.ts'
import type { LddPaths } from './paths.ts'
import { configureTray } from './tray.ts'
import { installNavigationGuards, makeWindowOptions } from './window.ts'

const pluginCenterUrl = 'https://github.com/topics/dsh-plugin'

/** Inject the LDD glass theme into the harness page. Uses executeJavaScript to
 * append a <style id="ldd-glass-theme"> to <head> (guaranteed last, after the
 * static <link> stylesheets, so the variable overrides win) rather than
 * insertCSS. Splash/failure pages are LDD's own file:// documents (the splash
 * carries its own glass backdrop in splash.html) and are left untouched. */
function attachGlassTheme(target: BrowserWindow): void {
  target.webContents.on('did-finish-load', () => {
    if (!target.webContents.getURL().startsWith('http')) return
    const script = `(() => {
      if (document.getElementById('ldd-glass-theme')) return;
      const style = document.createElement('style');
      style.id = 'ldd-glass-theme';
      style.textContent = ${JSON.stringify(GLASS_THEME_CSS)};
      document.head.appendChild(style);
    })()`
    void target.webContents.executeJavaScript(script).catch((error: unknown) => {
      console.error('[ldd-glass] inject failed:', error)
    })
  })
}

export type BootResult =
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'failure'; readonly diagnostics: readonly string[] }

export interface DesktopRuntimePort {
  boot(): Promise<BootResult>
  getStatus(): Promise<RuntimeStatusView>
  checkForUpdates(manual?: boolean): Promise<unknown>
  downloadUpdate(version: string): Promise<unknown>
  activateVersion(version: string): Promise<BootResult>
  importOfflineRuntime(archivePath: string): Promise<unknown>
  rollback(): Promise<BootResult>
  setImageMode(mode: 'standard' | 'large'): Promise<unknown>
  disposeUpdater(): Promise<void>
  stopHarness(): Promise<void>
}

export interface DesktopShellOptions {
  readonly paths: LddPaths
  readonly runtime: DesktopRuntimePort
  readonly trayIconPath: string
}

export async function createDesktopShell(options: DesktopShellOptions): Promise<{
  readonly mainWindow: BrowserWindow
  completeExit(): Promise<void>
}> {
  await mkdir(options.paths.logsRoot, { mode: 0o700, recursive: true })
  const exitState: ExitState = { exiting: false }
  let verifiedHarnessOrigin: string | null = null
  let harnessUrl: string | null = null
  let hasTray = false
  let requestExit = () => undefined

  const mainWindow = new BrowserWindow(makeWindowOptions(options.paths.preloadScript))
  mainWindow.on('close', createWindowCloseHandler(exitState, () => {
    if (hasTray) mainWindow.hide()
    else requestExit()
  }))
  installNavigationGuards(
    mainWindow.webContents,
    () => verifiedHarnessOrigin,
    async (url) => shell.openExternal(url),
    rendererFileUrl(options.paths),
  )
  attachGlassTheme(mainWindow)

  // 立即显示启动加载画面（LDD 字标 + 旋转指示），覆盖内核完整性校验
  // （首次启动可达数分钟）期间的等待，避免窗口停留在空白状态。
  await mainWindow.loadFile(options.paths.splashHtml)
  mainWindow.show()

  const loadBootResult = async (result: BootResult): Promise<void> => {
    if (result.kind === 'ready') {
      verifiedHarnessOrigin = new URL(result.url).origin
      harnessUrl = result.url
      await mainWindow.loadURL(result.url)
      return
    }
    verifiedHarnessOrigin = null
    await mainWindow.loadFile(options.paths.rendererHtml, {
      query: { view: 'failure' },
    })
  }

  const runAndReport = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'LDD 操作未完成',
        message: error instanceof Error ? error.message : '操作未完成，请查看日志。',
        buttons: ['确定'],
      })
    }
  }

  const showManagement = async (pluginRisk = false): Promise<void> => {
    const management = new BrowserWindow(makeWindowOptions(options.paths.preloadScript))
    installNavigationGuards(
      management.webContents,
      () => verifiedHarnessOrigin,
      async (url) => shell.openExternal(url),
      rendererFileUrl(options.paths),
    )
    await management.loadFile(options.paths.rendererHtml, {
      query: pluginRisk ? { pluginRisk: '1' } : {},
    })
    management.once('ready-to-show', () => management.show())
    if (!management.isVisible()) management.show()
  }

  const openLogs = async (): Promise<void> => {
    await mkdir(options.paths.logsRoot, { mode: 0o700, recursive: true })
    const error = await shell.openPath(options.paths.logsRoot)
    if (error.length > 0) throw new Error(`无法打开日志目录：${error}`)
  }

  const newWindow = async (): Promise<void> => {
    const win = new BrowserWindow(makeWindowOptions(options.paths.preloadScript))
    installNavigationGuards(
      win.webContents,
      () => verifiedHarnessOrigin,
      async (url) => shell.openExternal(url),
      rendererFileUrl(options.paths),
    )
    attachGlassTheme(win)
    if (harnessUrl !== null) {
      await win.loadURL(harnessUrl)
    } else {
      await win.loadFile(options.paths.rendererHtml)
    }
    win.once('ready-to-show', () => win.show())
    if (!win.isVisible()) win.show()
  }

  const saveImage = async (data: ArrayBuffer, defaultName: string): Promise<{ saved: boolean; path?: string }> => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存图片',
      defaultPath: defaultName,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    })
    if (result.canceled || result.filePath === undefined) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  }

  const importFile = (data: ArrayBuffer, fileName: string, workspacePath: string) =>
    importWorkspaceFile(data, fileName, workspacePath)

  const importOfflineRuntime = async (): Promise<unknown> => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '导入 LDD 离线内核包',
      properties: ['openFile'],
      filters: [{ name: 'LDD Runtime', extensions: ['lddruntime'] }],
    })
    const archivePath = selected.canceled ? undefined : selected.filePaths[0]
    return archivePath === undefined ? { kind: 'cancelled' } : options.runtime.importOfflineRuntime(archivePath)
  }

  const activateAndLoad = async (version: string): Promise<BootResult> => {
    const result = await options.runtime.activateVersion(version)
    await loadBootResult(result)
    return result
  }

  const rollbackAndLoad = async (): Promise<BootResult> => {
    const result = await options.runtime.rollback()
    await loadBootResult(result)
    return result
  }

  const retryAndLoad = async (): Promise<BootResult> => {
    const result = await options.runtime.boot()
    await loadBootResult(result)
    if (result.kind === 'failure') {
      throw new Error(result.diagnostics.join('\n') || '没有可启动的 Harness 内核')
    }
    return result
  }

  const unregisterIpc = registerDesktopIpc(ipcMain, {
    getStatus: () => options.runtime.getStatus(),
    checkForUpdates: () => options.runtime.checkForUpdates(),
    downloadUpdate: (version) => options.runtime.downloadUpdate(version),
    activateVersion: activateAndLoad,
    importOfflineRuntime,
    rollback: rollbackAndLoad,
    setImageMode: (mode) => options.runtime.setImageMode(mode),
    openPluginCenter: async () => shell.openExternal(pluginCenterUrl),
    retryBoot: retryAndLoad,
    openLogDirectory: openLogs,
    saveImage,
    importFile,
  })

  let destroyTray: () => void = () => undefined
  const completeExit = createCompleteExit(exitState, {
    disposeUpdater: options.runtime.disposeUpdater,
    stopHarness: options.runtime.stopHarness,
    quit: () => {
      unregisterIpc()
      destroyTray()
      app.quit()
    },
  })
  requestExit = () => void completeExit().catch((error: unknown) => {
    void runAndReport(async () => { throw error })
  })

  const help = createHelpMenu({
    openUpdate: () => showManagement(false),
    showCurrentRuntime: async () => {
      const status = await options.runtime.getStatus()
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '当前 Harness 内核',
        message: status.activeVersion ?? '只读 Fallback',
        detail: `上一可用：${status.lastKnownGoodVersion ?? '尚未记录'}\n通道：${status.channel}`,
        buttons: ['确定'],
      })
    },
    rollback: () => runAndReport(rollbackAndLoad),
    openPluginCenter: () => showManagement(true),
    openLogs: () => runAndReport(openLogs),
  })
  const helpTemplate: MenuItemConstructorOptions = {
    label: '帮助',
    submenu: help.map((item) => ({
      id: item.id,
      label: item.label,
      click: () => void runAndReport(async () => item.activate()),
    })),
  }
  const fileTemplate = createFileMenu({ newWindow, exit: requestExit })
  const editTemplate = createEditMenu()
  Menu.setApplicationMenu(Menu.buildFromTemplate([fileTemplate, editTemplate, helpTemplate]))

  let trayIcon = nativeImage.createFromPath(options.trayIconPath)
  if (trayIcon.isEmpty()) {
    trayIcon = await app.getFileIcon(process.execPath, { size: 'small' }).catch(() => nativeImage.createEmpty())
  }
  if (!trayIcon.isEmpty()) {
    const tray = new Tray(trayIcon)
    const trayMenu = Menu.buildFromTemplate([
      { label: '显示 LDD', click: () => { mainWindow.show(); mainWindow.focus() } },
      { label: 'Harness 内核更新…', click: () => void runAndReport(() => showManagement(false)) },
      { type: 'separator' },
      { label: '完整退出', click: requestExit },
    ])
    destroyTray = configureTray(tray, mainWindow, trayMenu)
    hasTray = true
  }

  app.on('before-quit', (event) => {
    if (exitState.exiting) return
    event.preventDefault()
    requestExit()
  })

  await loadBootResult(await options.runtime.boot())
  mainWindow.once('ready-to-show', () => mainWindow.show())
  if (!mainWindow.isVisible()) mainWindow.show()
  const updateTimer = setTimeout(() => {
    void options.runtime.checkForUpdates(false).then(async (result) => {
      const version = availableVersion(result)
      if (version === null || mainWindow.isDestroyed()) return
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Harness 内核有可用更新',
        message: `DeepSeek Harness ${version} 可以下载。`,
        detail: '更新只替换 Harness 内核，不会覆盖 LDD 桌面端、会话或配置。',
        buttons: ['查看更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (answer.response === 0) await showManagement(false)
    }).catch(() => undefined)
  }, 5_000)
  updateTimer.unref()
  return { mainWindow, completeExit }
}

export function rendererFileUrl(paths: LddPaths, query: Readonly<Record<string, string>> = {}): string {
  const url = pathToFileURL(paths.rendererHtml)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.href
}

function availableVersion(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const release = (value as Record<string, unknown>).release
  if (typeof release !== 'object' || release === null || Array.isArray(release)) return null
  const version = (release as Record<string, unknown>).version
  return typeof version === 'string' ? version : null
}

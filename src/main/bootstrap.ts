import { homedir } from 'node:os'
import { join } from 'node:path'

import { app, BrowserWindow, dialog } from 'electron'

import { createDesktopShell } from './index.ts'
import { publishRuntimeProgress } from './ipc/register.ts'
import { locationFilePath, readDataLocation } from './data-location.ts'
import { inspectMigration, migrateHarnessHome } from './migration/harness-home.ts'
import { ensureLddDirectories, resolveLddPaths, type LddPaths } from './paths.ts'
import { DesktopRuntimeController } from './runtime/controller.ts'

const singleInstance = app.requestSingleInstanceLock()

if (!singleInstance) {
  app.quit()
} else {
  app.setAppUserModelId('com.ldd.desktop')
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  void startApplication()
}

async function startApplication(): Promise<void> {
  try {
    await app.whenReady()
    const roamingAppData = app.getPath('appData')
    const location = await readDataLocation(locationFilePath(roamingAppData))
    const paths = developmentPaths(resolveLddPaths(
      process.env.LOCALAPPDATA ?? app.getPath('userData'),
      process.resourcesPath,
      roamingAppData,
      location.dataDirectory,
    ))
    await ensureLddDirectories(paths)
    const runtime = new DesktopRuntimeController({
      paths,
      desktopVersion: app.getVersion(),
      onProgress: (event) => publishRuntimeProgress(
        BrowserWindow.getAllWindows().map((window) => window.webContents),
        event,
      ),
    })
    await offerLegacyMigration(paths, runtime)
    await createDesktopShell({
      paths,
      runtime,
      trayIconPath: join(process.resourcesPath, 'assets', 'icon.png'),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LDD 初始化失败'
    await dialog.showMessageBox({
      type: 'error',
      title: 'LDD 无法启动',
      message,
      detail: '原 Harness 数据和已下载内核不会被删除。',
      buttons: ['退出'],
    })
    app.exit(1)
  }
}

function developmentPaths(paths: LddPaths): LddPaths {
  if (app.isPackaged) return paths
  return {
    ...paths,
    rendererHtml: join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
    splashHtml: join(app.getAppPath(), 'dist', 'renderer', 'splash.html'),
    preloadScript: join(app.getAppPath(), 'dist', 'main', 'preload', 'index.cjs'),
  }
}

async function offerLegacyMigration(
  paths: LddPaths,
  runtime: DesktopRuntimeController,
): Promise<void> {
  const oldHome = join(homedir(), '.dsh')
  const inspection = await inspectMigration(oldHome, paths.dshHome)
  if (inspection.kind !== 'needs-confirmation') return
  const answer = await dialog.showMessageBox({
    type: 'question',
    title: '发现旧版 Harness 数据',
    message: '是否复制并验证旧版会话、配置和插件？',
    detail: `来源：${oldHome}\n目标：${paths.dshHome}\n\n只复制，不会移动或删除原目录。`,
    buttons: ['复制并验证（推荐）', '使用全新配置'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (answer.response !== 0) return
  let result: Awaited<ReturnType<typeof migrateHarnessHome>>
  try {
    result = await migrateHarnessHome({
      oldHome,
      newHome: paths.dshHome,
      backupsRoot: paths.backupsRoot,
    }, (candidateHome) => runtime.probeHarnessHome(candidateHome))
  } catch (error) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '旧版数据复制失败',
      message: error instanceof Error ? error.message : '旧版数据复制失败',
      detail: `LDD 将使用全新配置；旧目录仍保留在 ${oldHome}。`,
      buttons: ['继续'],
    })
    return
  }
  if (result.kind === 'incompatible') {
    await dialog.showMessageBox({
      type: 'warning',
      title: '旧版数据暂未迁移',
      message: result.reason,
      detail: `LDD 将使用全新配置；旧目录仍保留在 ${result.oldHome}。`,
      buttons: ['继续'],
    })
  }
}

import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export interface LddPaths {
  readonly dataRoot: string
  readonly dshHome: string
  readonly settingsPath: string
  readonly runtimeRoot: string
  readonly statePath: string
  readonly versionsRoot: string
  readonly stagingRoot: string
  readonly downloadsRoot: string
  readonly backupsRoot: string
  readonly logsRoot: string
  readonly videoCacheRoot: string
  readonly resourcesRoot: string
  readonly runtimeHostRoot: string
  readonly fallbackRoot: string
  readonly rendererHtml: string
  readonly preloadScript: string
}

export function resolveLddPaths(
  localAppData: string,
  resourcesRoot: string,
  roamingAppData: string = localAppData,
): LddPaths {
  if (!isAbsolute(localAppData) || !isAbsolute(resourcesRoot) || !isAbsolute(roamingAppData)) {
    throw new TypeError('LDD path roots must be absolute')
  }
  const dataRoot = resolve(localAppData, 'LDD')
  const runtimeRoot = join(dataRoot, 'runtime')
  const normalizedResources = resolve(resourcesRoot)
  return {
    dataRoot,
    dshHome: join(resolve(roamingAppData), 'LDD', 'harness'),
    settingsPath: join(dataRoot, 'settings.json'),
    runtimeRoot,
    statePath: join(runtimeRoot, 'state.json'),
    versionsRoot: join(runtimeRoot, 'versions'),
    stagingRoot: join(runtimeRoot, 'staging'),
    downloadsRoot: join(runtimeRoot, 'downloads'),
    backupsRoot: join(dataRoot, 'backups'),
    logsRoot: join(dataRoot, 'logs'),
    videoCacheRoot: join(dataRoot, 'cache', 'video'),
    resourcesRoot: normalizedResources,
    runtimeHostRoot: join(normalizedResources, 'runtime-host'),
    fallbackRoot: join(normalizedResources, 'runtime-fallback'),
    rendererHtml: join(normalizedResources, 'app.asar', 'dist', 'renderer', 'index.html'),
    preloadScript: join(normalizedResources, 'app.asar', 'dist', 'main', 'preload', 'index.cjs'),
  }
}

export async function ensureLddDirectories(paths: LddPaths): Promise<void> {
  for (const path of [
    paths.dataRoot,
    paths.dshHome,
    paths.runtimeRoot,
    paths.versionsRoot,
    paths.stagingRoot,
    paths.downloadsRoot,
    paths.backupsRoot,
    paths.logsRoot,
    paths.videoCacheRoot,
  ]) {
    await mkdir(path, { mode: 0o700, recursive: true })
  }
}

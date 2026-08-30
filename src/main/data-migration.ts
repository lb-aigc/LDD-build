/**
 * Relocate LDD's data tree to a directory the user chooses (usually another
 * drive), copying — never moving — so the original data is left intact as a
 * safety net until the user deletes it. Two sources land under one new root:
 *
 *   `oldDataRoot` (settings, kernels, logs, cache)  → `<newDataDirectory>`
 *   `oldDshHome`  (sessions, attachments, plugins)  → `<newDataDirectory>\harness`
 *
 * The copy is cross-drive safe (copy, not rename). The caller must stop the
 * running Harness before invoking this — live session/attachment files are
 * otherwise read mid-write.
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export interface DataMigrationPaths {
  readonly oldDataRoot: string
  readonly oldDshHome: string
  readonly newDataDirectory: string
}

export type DataMigrationPhase =
  | 'validate'
  | 'copy-app-data'
  | 'copy-sessions'
  | 'done'

export interface DataMigrationResult {
  readonly dataDirectory: string
  readonly dataRoot: string
  readonly dshHome: string
}

export async function migrateDataDirectory(
  paths: DataMigrationPaths,
  onProgress?: (phase: DataMigrationPhase, detail: string) => void,
): Promise<DataMigrationResult> {
  const newDataDirectory = resolve(paths.newDataDirectory)
  const oldDataRoot = resolve(paths.oldDataRoot)
  const oldDshHome = resolve(paths.oldDshHome)

  onProgress?.('validate', `校验目标目录 ${newDataDirectory}`)
  await assertRelocationTarget(newDataDirectory, oldDataRoot, oldDshHome)

  // App data first: it creates the target root and its contents.
  onProgress?.('copy-app-data', `复制应用数据（内核/日志/缓存）`)
  await mkdir(newDataDirectory, { mode: 0o700, recursive: true })
  await copyTreeIfPresent(oldDataRoot, newDataDirectory)

  // Sessions/attachments land under <target>\harness.
  onProgress?.('copy-sessions', `复制会话与附件数据`)
  await copyTreeIfPresent(oldDshHome, join(newDataDirectory, 'harness'))

  onProgress?.('done', '数据目录迁移完成')
  return {
    dataDirectory: newDataDirectory,
    dataRoot: newDataDirectory,
    dshHome: join(newDataDirectory, 'harness'),
  }
}

/** Reject a target that is not a fresh, empty location (no overwrite/merge). */
async function assertRelocationTarget(
  target: string,
  oldDataRoot: string,
  oldDshHome: string,
): Promise<void> {
  if (!isAbsolute(target)) {
    throw new Error('数据目录必须是绝对路径')
  }
  if (target === oldDataRoot || target === oldDshHome) {
    throw new Error('目标目录不能是当前数据目录本身')
  }
  if (isWithin(target, oldDataRoot) || isWithin(target, oldDshHome)) {
    throw new Error('目标目录不能位于当前数据目录之内')
  }
  if (isWithin(oldDataRoot, target) || isWithin(oldDshHome, target)) {
    throw new Error('目标目录不能是当前数据目录的父目录')
  }
  const existing = await stat(target).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  })
  if (existing === null) return
  if (!existing.isDirectory()) {
    throw new Error(`目标路径不是目录：${target}`)
  }
  const children = await readdir(target)
  if (children.length > 0) {
    throw new Error(`目标目录非空，请选择空目录或新目录：${target}`)
  }
}

/** Copy one source tree's contents into an existing destination; a missing source is skipped. */
async function copyTreeIfPresent(source: string, destination: string): Promise<void> {
  const sourceExists = await stat(source).then(
    (info) => info.isDirectory(),
    (error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return false
      throw error
    },
  )
  if (!sourceExists) {
    await mkdir(destination, { mode: 0o700, recursive: true })
    return
  }
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: false,
    preserveTimestamps: true,
  })
}

/** Whether `path` is `root` or a descendant of it (normalized, case-insensitive on Windows). */
function isWithin(path: string, root: string): boolean {
  const normalizedPath = normalizeForCompare(path)
  const normalizedRoot = normalizeForCompare(root)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`)
}

function normalizeForCompare(path: string): string {
  return resolve(path).replace(/[\\/]+$/, '').toLowerCase()
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

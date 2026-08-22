import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'
import {
  copyInventory,
  inventoryTree,
  verifyInventory,
  type InventoryEntry,
} from './inventory.ts'

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export interface VersionBackup {
  readonly path: string
  readonly reportPath: string
  readonly targetVersion: string
  readonly entryCount: number
  readonly totalBytes: number
}

export async function createVersionBackup(
  dshHome: string,
  backupsRoot: string,
  targetVersion: string,
): Promise<VersionBackup> {
  if (!semanticVersionPattern.test(targetVersion)) {
    throw new TypeError('backup targetVersion must be semantic')
  }
  const inventory = await inventoryTree(dshHome)
  await mkdir(backupsRoot, { mode: 0o700, recursive: true })
  const id = randomUUID()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const candidatePath = join(backupsRoot, `.backup-staging-${id}`)
  const backupPath = join(backupsRoot, `harness-before-${targetVersion}-${timestamp}-${id}`)
  const reportPath = `${backupPath}.json`
  let committed = false
  try {
    await copyInventory(dshHome, candidatePath, inventory)
    await verifyInventory(candidatePath, inventory)
    const summary = inventorySummary(inventory)
    await writeAtomicJson(reportPath, {
      schemaVersion: 1,
      status: 'verified',
      recordedAt: new Date().toISOString(),
      source: dshHome,
      backupPath,
      targetVersion,
      ...summary,
    })
    await rename(candidatePath, backupPath)
    committed = true
    return { path: backupPath, reportPath, targetVersion, ...summary }
  } finally {
    if (!committed) {
      await cleanupBackupCandidate(candidatePath, backupsRoot)
    }
  }
}

async function cleanupBackupCandidate(candidatePath: string, backupsRoot: string): Promise<void> {
  if (
    dirname(resolve(candidatePath)) !== resolve(backupsRoot) ||
    !basename(candidatePath).startsWith('.backup-staging-')
  ) {
    throw new Error('refusing to clean a non-backup candidate')
  }
  try {
    const metadata = await lstat(candidatePath)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('refusing to clean a link-shaped backup candidate')
    }
    await rm(candidatePath, { force: false, recursive: true })
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error
    }
  }
}

function inventorySummary(inventory: readonly InventoryEntry[]): {
  readonly entryCount: number
  readonly totalBytes: number
} {
  return {
    entryCount: inventory.length,
    totalBytes: inventory.reduce(
      (total, entry) => total + (entry.kind === 'file' ? entry.size : 0),
      0,
    ),
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

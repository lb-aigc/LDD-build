import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'
import {
  copyInventory,
  inventoryTree,
  verifyInventory,
  type InventoryEntry,
} from './inventory.ts'

export interface MigrationPaths {
  readonly oldHome: string
  readonly newHome: string
  readonly backupsRoot: string
}

export type MigrationInspection =
  | { readonly kind: 'none' }
  | { readonly kind: 'needs-confirmation' }
  | { readonly kind: 'already-initialized' }

export type CompatibilityProbeResult =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reason: string }

export type MigrationResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'already-initialized' }
  | {
      readonly kind: 'incompatible'
      readonly reason: string
      readonly oldHome: string
      readonly reportPath: string
      readonly cleanStartAvailable: true
    }
  | {
      readonly kind: 'migrated'
      readonly oldHome: string
      readonly newHome: string
      readonly reportPath: string
    }

export async function inspectMigration(
  oldHome: string,
  newHome: string,
): Promise<MigrationInspection> {
  const newState = await inspectDirectory(newHome)
  if (newState === 'nonempty') {
    return { kind: 'already-initialized' }
  }
  const oldState = await inspectDirectory(oldHome)
  if (oldState === 'nonempty') {
    return { kind: 'needs-confirmation' }
  }
  return { kind: 'none' }
}

export async function migrateHarnessHome(
  paths: MigrationPaths,
  compatibilityProbe: (candidateHome: string) => Promise<CompatibilityProbeResult>,
): Promise<MigrationResult> {
  const inspection = await inspectMigration(paths.oldHome, paths.newHome)
  if (inspection.kind !== 'needs-confirmation') {
    return inspection
  }

  const sourceInventory = await inventoryTree(paths.oldHome)
  const candidateHome = `${paths.newHome}.migration-${randomUUID()}`
  await mkdir(dirname(paths.newHome), { mode: 0o700, recursive: true })
  let committed = false
  try {
    await copyInventory(paths.oldHome, candidateHome, sourceInventory)
    await verifyInventory(candidateHome, sourceInventory)
    const probe = await compatibilityProbe(candidateHome)
    if (!probe.compatible) {
      const reportPath = await writeMigrationReport(paths.backupsRoot, {
        status: 'incompatible',
        reason: probe.reason,
        oldHome: paths.oldHome,
        proposedNewHome: paths.newHome,
        ...inventorySummary(sourceInventory),
      })
      return {
        kind: 'incompatible',
        reason: probe.reason,
        oldHome: paths.oldHome,
        reportPath,
        cleanStartAvailable: true,
      }
    }

    const reportPath = await writeMigrationReport(paths.backupsRoot, {
      status: 'verified-compatible',
      oldHome: paths.oldHome,
      proposedNewHome: paths.newHome,
      ...inventorySummary(sourceInventory),
    })
    if ((await inspectDirectory(paths.newHome)) === 'empty') {
      await rmdir(paths.newHome)
    }
    await rename(candidateHome, paths.newHome)
    committed = true
    return {
      kind: 'migrated',
      oldHome: paths.oldHome,
      newHome: paths.newHome,
      reportPath,
    }
  } finally {
    if (!committed) {
      await cleanupCandidate(candidateHome, paths.newHome)
    }
  }
}

async function inspectDirectory(path: string): Promise<'absent' | 'empty' | 'nonempty'> {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Harness home is link-shaped or not a directory: ${path}`)
    }
    return (await readdir(path)).length === 0 ? 'empty' : 'nonempty'
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return 'absent'
    }
    throw error
  }
}

async function writeMigrationReport(
  backupsRoot: string,
  report: Readonly<Record<string, unknown>>,
): Promise<string> {
  await mkdir(backupsRoot, { mode: 0o700, recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(backupsRoot, `migration-${timestamp}-${randomUUID()}.json`)
  await writeAtomicJson(reportPath, {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    ...report,
  })
  return reportPath
}

async function cleanupCandidate(candidateHome: string, newHome: string): Promise<void> {
  const expectedPrefix = `${basename(newHome)}.migration-`
  if (
    dirname(resolve(candidateHome)) !== dirname(resolve(newHome)) ||
    !basename(candidateHome).startsWith(expectedPrefix)
  ) {
    throw new Error('refusing to clean a non-migration candidate')
  }
  try {
    const metadata = await lstat(candidateHome)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('refusing to clean a link-shaped migration candidate')
    }
    await rm(candidateHome, { force: false, recursive: true })
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error
    }
  }
}

function inventorySummary(inventory: readonly InventoryEntry[]): {
  readonly entryCount: number
  readonly fileCount: number
  readonly totalBytes: number
} {
  return {
    entryCount: inventory.length,
    fileCount: inventory.filter((entry) => entry.kind === 'file').length,
    totalBytes: inventory.reduce(
      (total, entry) => total + (entry.kind === 'file' ? entry.size : 0),
      0,
    ),
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

import { lstat, mkdir, readFile, rename } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  extractRuntimeArchive,
  type RuntimeArchiveLimits,
  type RuntimeArchiveOpener,
  type VerifiedExtraction,
} from './archive.ts'
import { parseRuntimeManifest, type RuntimeManifest } from './manifest.ts'
import {
  readRuntimeState,
  writeRuntimeState,
  type RuntimeState,
} from './state.ts'
import {
  RuntimeTransaction,
  type RuntimeTransactionState,
} from './transaction.ts'

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export interface InstalledRuntime {
  readonly version: string
  readonly path: string
  readonly manifest: RuntimeManifest
}

export interface RuntimeCandidateHandle {
  stop(): Promise<void>
}

export interface RuntimeLifecycle {
  stopCurrent(): Promise<void>
  startCandidate(runtime: InstalledRuntime): Promise<RuntimeCandidateHandle>
  restorePrevious(state: RuntimeState): Promise<void>
}

export interface RuntimeInstallerOptions {
  readonly statePath: string
  readonly stagingRoot: string
  readonly versionsRoot: string
  readonly lifecycle: RuntimeLifecycle
  readonly resolveInstalledRuntime?: (version: string) => Promise<InstalledRuntime | null>
  readonly beforeActivate?: (runtime: InstalledRuntime, state: RuntimeState) => Promise<void>
  readonly onProgress?: (state: RuntimeTransactionState) => void | Promise<void>
}

export interface InstallRuntimeInput {
  readonly archivePath: string
  readonly limits: RuntimeArchiveLimits
  readonly openArchive?: RuntimeArchiveOpener
}

export interface ActivatedRuntime {
  readonly runtime: InstalledRuntime
  readonly handle: RuntimeCandidateHandle
}

export type CandidateHealthObserver = (candidate: VerifiedExtraction) => Promise<void>
export type ActivationObserver = (
  handle: RuntimeCandidateHandle,
  runtime: InstalledRuntime,
) => Promise<void>

export class RuntimeInstaller {
  readonly #options: RuntimeInstallerOptions
  readonly #resolveInstalledRuntime: (version: string) => Promise<InstalledRuntime | null>

  constructor(options: RuntimeInstallerOptions) {
    this.#options = options
    this.#resolveInstalledRuntime =
      options.resolveInstalledRuntime ??
      ((version) => resolveInstalledRuntime(options.versionsRoot, version))
  }

  async install(
    input: InstallRuntimeInput,
    observer: CandidateHealthObserver,
  ): Promise<InstalledRuntime> {
    const transaction = await RuntimeTransaction.create(this.#options.stagingRoot)
    try {
      await this.#transition(transaction, 'extracting')
      const payloadPath = transaction.childPath('payload')
      const extraction =
        input.openArchive === undefined
          ? await extractRuntimeArchive(input.archivePath, payloadPath, input.limits)
          : await extractRuntimeArchive(
              input.archivePath,
              payloadPath,
              input.limits,
              input.openArchive,
            )
      await this.#transition(transaction, 'verifying')
      await this.#transition(transaction, 'health-checking')
      await observer(extraction)

      const version = extraction.manifest.harnessVersion
      const installedPath = resolveVersionPath(this.#options.versionsRoot, version)
      await mkdir(this.#options.versionsRoot, { mode: 0o700, recursive: true })
      if (await pathExists(installedPath)) {
        throw new Error(`runtime version is already installed: ${version}`)
      }
      await rename(payloadPath, installedPath)
      await this.#transition(transaction, 'installed')
      return { version, path: installedPath, manifest: extraction.manifest }
    } catch (error) {
      await this.#markFailed(transaction)
      throw error
    } finally {
      await transaction.cleanup()
    }
  }

  async activate(version: string, observer: ActivationObserver): Promise<ActivatedRuntime> {
    if (!semanticVersionPattern.test(version)) {
      throw new TypeError('runtime version must be semantic')
    }
    const read = await readRuntimeState(this.#options.statePath)
    if (read.diagnostics.length > 0) {
      throw new Error('runtime state must be repaired before activation')
    }
    const before = read.state
    const runtime = await this.#resolveInstalledRuntime(version)
    if (runtime === null) {
      throw new Error(`runtime version is not installed: ${version}`)
    }
    await this.#options.beforeActivate?.(runtime, before)

    const transaction = await RuntimeTransaction.create(this.#options.stagingRoot)
    let handle: RuntimeCandidateHandle | undefined
    let pendingWritten = false
    let currentStopped = false
    try {
      await this.#transition(transaction, 'activating')
      await writeRuntimeState(this.#options.statePath, {
        ...before,
        pendingVersion: version,
      })
      pendingWritten = true
      await this.#options.lifecycle.stopCurrent()
      currentStopped = true
      handle = await this.#options.lifecycle.startCandidate(runtime)
      await this.#transition(transaction, 'observing')
      await observer(handle, runtime)
      await writeRuntimeState(this.#options.statePath, {
        ...before,
        activeVersion: version,
        lastKnownGoodVersion: before.activeVersion ?? before.lastKnownGoodVersion,
        pendingVersion: null,
      })
      await this.#transition(transaction, 'committed')
      return { runtime, handle }
    } catch (error) {
      const rollbackErrors: unknown[] = []
      if (handle !== undefined) {
        await handle.stop().catch((stopError: unknown) => rollbackErrors.push(stopError))
      }
      if (pendingWritten) {
        await writeRuntimeState(this.#options.statePath, before).catch((stateError: unknown) =>
          rollbackErrors.push(stateError),
        )
      }
      if (currentStopped) {
        await this.#options.lifecycle
          .restorePrevious(before)
          .catch((restoreError: unknown) => rollbackErrors.push(restoreError))
      }
      await this.#transition(transaction, 'rolled-back').catch((transitionError: unknown) =>
        rollbackErrors.push(transitionError),
      )
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], 'runtime activation and rollback failed')
      }
      throw error
    } finally {
      await transaction.cleanup()
    }
  }

  async #transition(
    transaction: RuntimeTransaction,
    state: RuntimeTransactionState,
  ): Promise<void> {
    await transaction.transition(state)
    try {
      await this.#options.onProgress?.(state)
    } catch {
      // Progress delivery is observational and must not corrupt a committed transaction state.
    }
  }

  async #markFailed(transaction: RuntimeTransaction): Promise<void> {
    if (transaction.state === 'installed' || transaction.state === 'failed') {
      return
    }
    await this.#transition(transaction, 'failed')
  }
}

async function resolveInstalledRuntime(
  versionsRoot: string,
  version: string,
): Promise<InstalledRuntime | null> {
  const installedPath = resolveVersionPath(versionsRoot, version)
  try {
    const metadata = await lstat(installedPath)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      return null
    }
    const manifest = parseRuntimeManifest(
      JSON.parse(await readFile(resolve(installedPath, 'runtime.json'), 'utf8')) as unknown,
    )
    if (manifest.harnessVersion !== version) {
      return null
    }
    return { version, path: installedPath, manifest }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function resolveVersionPath(versionsRoot: string, version: string): string {
  if (!semanticVersionPattern.test(version)) {
    throw new TypeError('runtime version must be semantic')
  }
  const root = resolve(versionsRoot)
  const installedPath = resolve(root, version)
  if (!installedPath.startsWith(`${root}${sep}`)) {
    throw new Error('runtime version path escapes the versions root')
  }
  return installedPath
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

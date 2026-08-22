import { readRuntimeState, writeRuntimeState } from './state.ts'
import type { ResolvedRuntimeRelease, RuntimeRegistry } from './registry.ts'

const automaticCheckIntervalMs = 24 * 60 * 60 * 1_000

export interface RuntimeUpdaterOptions {
  readonly statePath: string
  readonly registry: RuntimeRegistry
  readonly now?: () => Date
}

export type UpdateCheckResult =
  | { readonly kind: 'skipped'; readonly reason: 'checked-within-24-hours' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'available'; readonly release: ResolvedRuntimeRelease }

export class RuntimeUpdater {
  readonly #options: RuntimeUpdaterOptions

  constructor(options: RuntimeUpdaterOptions) {
    this.#options = options
  }

  async checkForUpdates(
    currentVersion: string,
    manual: boolean,
  ): Promise<UpdateCheckResult> {
    const read = await readRuntimeState(this.#options.statePath)
    if (read.diagnostics.length > 0) {
      throw new Error('runtime state must be repaired before checking for updates')
    }
    const now = this.#options.now?.() ?? new Date()
    if (!Number.isFinite(now.getTime())) {
      throw new Error('update clock returned an invalid date')
    }
    if (!manual && checkedRecently(read.state.lastCheckAt, now)) {
      return { kind: 'skipped', reason: 'checked-within-24-hours' }
    }

    await writeRuntimeState(this.#options.statePath, {
      ...read.state,
      lastCheckAt: now.toISOString(),
    })
    const release = await this.#options.registry.resolve(read.state.channel, currentVersion)
    return release === null ? { kind: 'up-to-date' } : { kind: 'available', release }
  }
}

function checkedRecently(lastCheckAt: string | null, now: Date): boolean {
  if (lastCheckAt === null) return false
  const elapsed = now.getTime() - Date.parse(lastCheckAt)
  return elapsed >= 0 && elapsed < automaticCheckIntervalMs
}

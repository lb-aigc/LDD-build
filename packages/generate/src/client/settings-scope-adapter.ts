/**
 * Settings-scope adapter: rebuilds the per-namespace `SettingsScope<T>` face
 * that dsh 0.1.5 shipped under `ctx.settingsScope.bind({ namespace })`, which
 * 0.2.0 removed. The replacement reads and writes through the 0.2.0 Remote
 * settings namespace (`ctx.remote.settings.describe` / `.mutate`) and refreshes
 * on the forwarded `settings/document-updated` event, so the two controllers
 * (card + model picker) keep their `getSnapshot / subscribe / set / unset`
 * contract without depending on the deleted service.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.remote.settings` / `ctx.remote.$on` merge and the
// settings wire vocabulary into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Per-namespace snapshot, mirroring the 0.1.5 `SettingsScopeSnapshot` shape
 *  the controllers already consume (status / value / writable). */
export interface SettingsScopeSnapshot<T> {
  /** `loading` until the first describe answer, `ready` while one stands, and
   *  `unavailable` when the read fails or the namespace is not exposed. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Redacted resolved value of the namespace, or undefined before the first
   *  successful read. */
  value: T | undefined
  /** Whether the profile accepts writes. */
  writable: boolean
}

/** Minimal per-namespace settings face consumed by the generate controllers. */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T>
  /** Observe snapshot replacements; returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Queue one field write. */
  set(field: string, value: unknown): Promise<void>
  /** Queue one field clear. */
  unset(field: string): Promise<void>
}

/**
 * One namespace's derived view over the 0.2.0 Remote settings document. Reads
 * ride `describe()`; writes fold through `mutate()` and re-read so the next
 * snapshot reflects the settlement.
 */
export class RemoteSettingsScope<T> implements SettingsScope<T> {
  private snapshot: SettingsScopeSnapshot<T> = { status: 'loading', value: undefined, writable: false }
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(
    private readonly ctx: ClientContext,
    private readonly ns: string,
  ) {
    void this.refresh()
    ctx.effect(() => {
      const off = ctx.remote.$on('settings/document-updated', (changedNs: unknown) => {
        if (String(changedNs) !== this.ns) return
        void this.refresh()
      })
      return () => {
        this.disposed = true
        off()
      }
    })
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    await this.mutate([{ op: 'set', path: [field], value: value as JsonValue }])
  }

  async unset(field: string): Promise<void> {
    await this.mutate([{ op: 'unset', path: [field] }])
  }

  private async mutate(ops: SettingsPathOpView[]): Promise<void> {
    const response = await this.ctx.remote.settings.mutate(this.ns, ops, undefined)
    if (!response.ok) {
      throw new Error(`settings.mutate(${this.ns}) refused: ${response.error.message}`)
    }
    void this.refresh()
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return
    try {
      const response = await this.ctx.remote.settings.describe()
      if (!response.ok) {
        this.snapshot = { status: 'unavailable', value: undefined, writable: false }
      } else {
        const view = response.value.namespaces.find((row) => row.ns === this.ns)
        this.snapshot = {
          status: 'ready',
          value: view?.value as T | undefined,
          writable: response.value.writable,
        }
      }
    } catch {
      this.snapshot = { status: 'unavailable', value: undefined, writable: false }
    }
    for (const listener of this.listeners) listener()
  }
}

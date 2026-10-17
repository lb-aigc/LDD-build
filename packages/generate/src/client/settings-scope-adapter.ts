/**
 * Settings-scope adapter: rebuilds the per-namespace `SettingsScope<T>` face
 * that dsh 0.1.5 shipped under `ctx.settingsScope.bind({ namespace })`, which
 * 0.2.0 removed. The replacement reads and writes through the 0.2.0 Remote
 * settings namespace (`ctx.remote.settings.describe` / `.mutate`) and refreshes
 * on the forwarded `settings/document-updated` event, so the two controllers
 * (card + model picker) keep their `getSnapshot / subscribe / set / unset`
 * contract without depending on the deleted service.
 *
 * The generate plugin does NOT declare `dsh-api-gateway` /
 * `dsh-api-settings-controller` as deps, so importing their remote types from
 * `dsh-api-remotes/client` collapses to `any` (that is the whole reason the
 * previous direct import failed `noImplicitAny`). We declare the wire shape
 * locally and reach `ctx.remote` through a structural cast instead.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** One redacted namespace row of a `settings.describe` answer. */
interface SettingsNamespaceRow {
  ns: string
  value: unknown
}

/** Shape of the 0.2.0 `ctx.remote.settings.describe()` RpcResponse. */
interface SettingsDescribeResult {
  ok: boolean
  value?: {
    writable: boolean
    namespaces: SettingsNamespaceRow[]
  }
  error?: { message: string }
}

/** Shape of the 0.2.0 `ctx.remote.settings.mutate()` RpcResponse. */
interface SettingsMutateResult {
  ok: boolean
  error?: { message: string }
}

/** Structural face of the 0.2.0 client `ctx.remote` we consume. */
interface SettingsRemoteFace {
  settings: {
    describe(): Promise<SettingsDescribeResult>
    mutate(ns: string, ops: unknown[], revision: number | undefined): Promise<SettingsMutateResult>
  }
  $on(event: string, listener: (...args: unknown[]) => void): () => void
}

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
    private readonly prefix: string,
  ) {
    void this.refresh()
    ctx.effect(() => {
      const off = this.remote().$on('settings/document-updated', (changedNs: unknown) => {
        if (String(changedNs) !== this.ns) return
        void this.refresh()
      })
      return () => {
        this.disposed = true
        off()
      }
    })
  }

  /** Structural cast to the client `ctx.remote` namespace this adapter reads. */
  private remote(): SettingsRemoteFace {
    return (this.ctx as unknown as { remote: SettingsRemoteFace }).remote
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    await this.mutate([{ op: 'set', path: [this.prefix, field], value }])
  }

  async unset(field: string): Promise<void> {
    await this.mutate([{ op: 'unset', path: [this.prefix, field] }])
  }

  private async mutate(ops: unknown[]): Promise<void> {
    const response = await this.remote().settings.mutate(this.ns, ops, undefined)
    if (!response.ok) {
      throw new Error(`settings.mutate(${this.ns}) refused: ${response.error?.message ?? 'unknown'}`)
    }
    void this.refresh()
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return
    try {
      const response = await this.remote().settings.describe()
      if (!response.ok || !response.value) {
        this.snapshot = { status: 'unavailable', value: undefined, writable: false }
      } else {
        const view = response.value.namespaces.find((row) => row.ns === this.ns)
        const raw = view?.value as Record<string, unknown> | undefined
        this.snapshot = {
          status: 'ready',
          value: raw?.[this.prefix] as T | undefined,
          writable: response.value.writable,
        }
      }
    } catch {
      this.snapshot = { status: 'unavailable', value: undefined, writable: false }
    }
    for (const listener of this.listeners) listener()
  }
}

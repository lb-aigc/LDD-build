/**
 * Composer model-picker controller: reads the configured image models (key +
 * label + default) from the generate-image settings namespace and issues a
 * per-session temporary switch (a `/generate-model` slash command). Kept
 * dependency-light like the card controller: settings scope + a commandable
 * session face are both shimmed, never imported from the harness packages.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { GenerationCardSettings } from './controller.ts'
import { resolvePickerModels } from './presets.ts'
import type { PickerModel } from './presets.ts'

/** Render state the picker button consumes. */
export interface ModelPickerState {
  readonly available: boolean
  readonly models: PickerModel[]
  readonly defaultKey: string
}

/** The face the slot entry injects (hook + the select action). */
export interface ModelPickerFace {
  readonly hooks: { readonly modelPicker: SnapshotStore<ModelPickerState> }
  readonly select: (key: string) => void
}

/** The sessions slice needed to run a slash command against one session. */
export interface CommandableSessions {
  binding(id: SessionId): { session: { command(line: string): Promise<unknown> } } | undefined
}

export class ModelPickerController {
  private readonly store: SnapshotStore<ModelPickerState>
  private readonly scope: SettingsScope<GenerationCardSettings>
  private readonly sessions: CommandableSessions | undefined
  private sessionId: SessionId | undefined

  constructor(
    scope: SettingsScope<GenerationCardSettings>,
    sessions: CommandableSessions | undefined,
  ) {
    this.scope = scope
    this.sessions = sessions
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
  }

  /** Adopt the current session (the slot inject is session-scoped). */
  setSessionId(sessionId: SessionId | undefined): void {
    this.sessionId = sessionId
  }

  private projection(): ModelPickerState {
    const snapshot = this.scope.getSnapshot()
    const resolved = resolvePickerModels(snapshot.value)
    return {
      available: snapshot.status === 'ready',
      models: resolved.models,
      defaultKey: resolved.defaultKey,
    }
  }

  inject(): ModelPickerFace {
    return {
      hooks: { modelPicker: this.store },
      select: (key) => {
        if (this.sessionId === undefined || this.sessions === undefined) return
        void this.sessions.binding(this.sessionId)?.session.command(`/generate-model ${key}`)
      },
    }
  }
}

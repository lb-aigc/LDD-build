/**
 * Composer model-picker controller: reads the configured image/video/music
 * models (key + label + default) from their three settings namespaces and
 * issues a per-session temporary switch (a `/generate-model <kind> <key>`
 * slash command). Kept dependency-light like the card controller: settings
 * scope + a commandable session face are both shimmed, never imported from the
 * harness packages.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GenerationCardSettings } from './controller.ts'
import {
  IMAGE_PRESETS,
  MUSIC_PRESETS,
  VIDEO_PRESETS,
  resolvePickerModels,
} from './presets.ts'
import type { ClientPreset, PickerModel } from './presets.ts'

/** Which generation modality a pick routes to. */
export type GenerationKind = 'image' | 'video' | 'music'

/** One generation modality's selectable models. */
export interface ModelPickerGroup {
  readonly kind: GenerationKind
  readonly models: PickerModel[]
  readonly defaultKey: string
}

/** Render state the picker button consumes. */
export interface ModelPickerState {
  readonly available: boolean
  readonly groups: ModelPickerGroup[]
  /** Per-session temporary override, keyed by SessionId. Lives on the
   *  controller (the plugin apply lifetime), NOT in component state — a
   *  component remount (composer re-render between turns) must not drop the
   *  user's pick, or the picker's check mark snaps back to the default. */
  readonly overrides: ReadonlyMap<string, Partial<Record<GenerationKind, string>>>
}

/** The face the slot entry injects (hook + the select action). */
export interface ModelPickerFace {
  readonly hooks: { readonly modelPicker: SnapshotStore<ModelPickerState> }
  readonly select: (kind: GenerationKind, key: string) => void
}

/** The sessions slice needed to run a slash command against one session. */
export interface CommandableSessions {
  binding(id: SessionId): { session: { command(line: string): Promise<unknown> } } | undefined
}

const KIND_PRESETS: Record<GenerationKind, readonly ClientPreset[]> = {
  image: IMAGE_PRESETS,
  video: VIDEO_PRESETS,
  music: MUSIC_PRESETS,
}

const KINDS: readonly GenerationKind[] = ['image', 'video', 'music']

export class ModelPickerController {
  private readonly store: SnapshotStore<ModelPickerState>
  private readonly scopes: Record<GenerationKind, SettingsScope<GenerationCardSettings>>
  private readonly sessions: CommandableSessions | undefined
  /** Per-session override source of truth for the picker UI. Persists across
   *  component remounts; the host keeps its own copy (via the `/generate-model`
   *  command), this one only feeds the check-mark display. */
  private readonly overrides = new Map<string, Partial<Record<GenerationKind, string>>>()

  constructor(
    scopes: {
      image: SettingsScope<GenerationCardSettings>
      video: SettingsScope<GenerationCardSettings>
      music: SettingsScope<GenerationCardSettings>
    },
    sessions: CommandableSessions | undefined,
  ) {
    this.scopes = scopes
    this.sessions = sessions
    this.store = createSnapshotStore(this.projection())
    for (const scope of Object.values(scopes)) {
      scope.subscribe(() => { this.store.set(this.projection()) })
    }
  }

  private projection(): ModelPickerState {
    const groups: ModelPickerGroup[] = []
    let available = true
    for (const kind of KINDS) {
      const snapshot = this.scopes[kind].getSnapshot()
      if (snapshot.status !== 'ready') available = false
      const resolved = resolvePickerModels(snapshot.value, KIND_PRESETS[kind])
      groups.push({ kind, models: resolved.models, defaultKey: resolved.defaultKey })
    }
    // Shallow-copy the override map: the store's `set` deep-freezes the state
    // in dev, and freezing the controller's live `this.overrides` Map would
    // make the next `set()` on it a no-op or throw.
    return { available, groups, overrides: new Map(this.overrides) }
  }

  /** Build the face for one session. `select` is bound to THAT session (the
   *  `sessionId` the slot inject passed in), never a shared mutable field, so a
   *  pick always issues its `/generate-model` command against the session the
   *  button was rendered for. A single shared `this.sessionId` was the bug that
   *  made "切换模型后不生效" when two sessions were open: the command landed in
   *  the LAST-injected session while the visible session kept its old override. */
  inject(sessionId: SessionId | undefined): ModelPickerFace {
    return {
      hooks: { modelPicker: this.store },
      select: (kind, key) => {
        if (sessionId === undefined || this.sessions === undefined) return
        const current = this.overrides.get(sessionId) ?? {}
        this.overrides.set(sessionId, { ...current, [kind]: key })
        this.store.set(this.projection())
        void this.sessions.binding(sessionId)?.session.command(`/generate-model ${kind} ${key}`)
      },
    }
  }
}

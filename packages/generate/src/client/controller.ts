/**
 * Staged form model behind one generation card. Self-contained (the reference
 * ui-settings-plugins exports only types). The card configures ONLY each
 * relay's API key — the model list is built-in (presets) and auto-derived from
 * which keys are configured, so the user never picks models or a default here.
 * Model choice lives in the composer picker (前端人为选择).
 */
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SettingsScope,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_PROVIDER,
  IMAGE_PRESETS,
  VIDEO_PRESETS,
  MUSIC_PRESETS,
  IMAGE_KEY_ENTRIES,
  VIDEO_KEY_ENTRIES,
  MUSIC_KEY_ENTRIES,
} from './presets.ts'
import type { ClientPreset, KeyEntry } from './presets.ts'

/** One persisted model entry (written to `settings.models`). */
export interface ModelDraft {
  provider: string
  protocol: string
  model: string
  imageToImageModel: string
  baseURL: string
  apiKeyEnv: string
}

/** One relay key row: its credential ref + label + configure state + edit text. */
export interface KeyRow extends KeyEntry {
  /** `credentials.describe` reports whether this ref is already configured. */
  configured: boolean
  /** This form's input (write-only; blank = leave unchanged). */
  value: string
}

/** The card's full render state. */
export interface GenerationCardState {
  kind: 'image' | 'video' | 'music'
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  keys: KeyRow[]
}

/** Face the card's slot entry injects (hooks + the two actions). */
export interface GenerationCardFace {
  hooks: {
    generationCard: SnapshotStore<GenerationCardState>
  }
  setKey: (ref: string, text: string) => void
  save: () => void
  discard: () => void
}

/** The settings namespace shape this card edits (models are auto-generated). */
export interface GenerationCardSettings {
  default?: string
  models?: ModelDraft[]
  provider?: string
  protocol?: string
  model?: string
  imageToImageModel?: string
  baseURL?: string
  apiKeyEnv?: string
}

export class GenerateSettingsController {
  private readonly store: SnapshotStore<GenerationCardState>
  private readonly keys: KeyRow[]
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<GenerationCardSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly kind: 'image' | 'video' | 'music',
  ) {
    this.keys = this.keyEntries.map((entry) => ({ ...entry, configured: false, value: '' }))
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
    void this.refreshConfigured()
  }

  private get presets(): readonly ClientPreset[] {
    return this.kind === 'image' ? IMAGE_PRESETS : this.kind === 'video' ? VIDEO_PRESETS : MUSIC_PRESETS
  }

  private get keyEntries(): readonly KeyEntry[] {
    return this.kind === 'image' ? IMAGE_KEY_ENTRIES : this.kind === 'video' ? VIDEO_KEY_ENTRIES : MUSIC_KEY_ENTRIES
  }

  private projection(): GenerationCardState {
    const snapshot = this.scope.getSnapshot()
    return {
      kind: this.kind,
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.isDirty(),
      saving: this.saving,
      failed: this.failed,
      keys: this.keys.map((key) => ({ ...key })),
    }
  }

  private isDirty(): boolean {
    return this.keys.some((key) => key.value.trim() !== '')
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** Read which keys are configured from the credentials domain (async). */
  private async refreshConfigured(): Promise<void> {
    const refs = this.keys.map((key) => key.ref)
    if (refs.length === 0) return
    const response = await this.api.credentials.describe({ refs })
    if (!response.result.ok) return
    const creds = response.result.value.credentials as Record<string, { configured?: boolean }>
    for (const key of this.keys) {
      key.configured = creds[key.ref]?.configured ?? false
    }
    this.publish()
  }

  inject(): GenerationCardFace {
    return {
      hooks: { generationCard: this.store },
      setKey: (ref, text) => {
        const key = this.keys.find((entry) => entry.ref === ref)
        if (key === undefined) return
        key.value = text
        this.failed = false
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        if (!this.isDirty()) return
        for (const key of this.keys) key.value = ''
        this.failed = false
        this.publish()
      },
    }
  }

  private async save(): Promise<void> {
    if (!this.isDirty() || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()

    let landed = true
    try {
      // 1. Write any key the user typed (blank leaves the stored value alone).
      for (const key of this.keys) {
        const text = key.value.trim()
        if (text === '') continue
        await this.api.credentials.set({ ref: key.ref, value: text })
      }
      // 2. Re-read the configured set after the writes.
      const refs = this.keys.map((key) => key.ref)
      const configured = new Set<string>()
      const response = await this.api.credentials.describe({ refs })
      if (response.result.ok) {
        const creds = response.result.value.credentials as Record<string, { configured?: boolean }>
        for (const [ref, view] of Object.entries(creds)) {
          if (view.configured) configured.add(ref)
        }
      }
      // 3. Auto-derive the model list from the configured keys: every relay
      //    whose key is set contributes ONE entry, and its full built-in model
      //    list expands in the composer picker (Host routing).
      await this.scope.set('models', this.buildModels(configured))
      // 4. Drop the default + legacy flat fields (no "default model" concept).
      await this.scope.unset('default')
      await this.scope.unset('provider')
      await this.scope.unset('protocol')
      await this.scope.unset('model')
      await this.scope.unset('baseURL')
      await this.scope.unset('apiKeyEnv')
      // 5. Reflect the new state and clear the inputs.
      for (const key of this.keys) {
        key.configured = configured.has(key.ref)
        key.value = ''
      }
    } catch {
      landed = false
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /** Model list derived from the configured keys: one entry per relay that has
   *  a configured key and a built-in model list. */
  private buildModels(configuredRefs: Set<string>): ModelDraft[] {
    const result: ModelDraft[] = []
    for (const preset of this.presets) {
      if (preset.id === DEFAULT_PROVIDER) continue
      const ref = preset.defaultApiKeyEnv
      if (ref === undefined || ref === '') continue
      if (preset.suggestedModels.length === 0) continue
      if (!configuredRefs.has(ref)) continue
      result.push({
        provider: preset.id,
        protocol: '',
        model: preset.suggestedModels[0]!.id,
        imageToImageModel: preset.suggestedModels[0]!.i2iModel ?? '',
        baseURL: '',
        apiKeyEnv: ref,
      })
    }
    return result
  }
}

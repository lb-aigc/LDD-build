/**
 * Staged form model behind one generation card. Self-contained (the reference
 * ui-settings-plugins exports only types). Edits a MODEL LIST (not one model):
 * each row is a provider preset or `custom` host, one row is marked default,
 * and the whole list plus the default key write back to the settings namespace
 * on save. API keys ride the credentials domain per-row, so the literal never
 * rides a response.
 */
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SettingsScope,
  SettingsScopeSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_PROVIDER,
  IMAGE_PRESETS,
  VIDEO_PRESETS,
  defaultApiKeyEnvOf,
  firstModelOf,
  i2iModelOf,
  routeKeyOf,
} from './presets.ts'
import type { ClientPreset } from './presets.ts'

/** One model row's persisted fields (written to `settings.models`). */
export interface ModelDraft {
  provider: string
  protocol: string
  model: string
  imageToImageModel: string
  baseURL: string
  apiKeyEnv: string
}

/** A draft row plus a stable front-end id so per-row edits survive reorder. */
export interface ModelRow extends ModelDraft {
  readonly uid: number
}

/** The credential reference a row resolves to (its `apiKeyEnv`, or the
 *  default when blank). All rows with the same ref share ONE API key. */
export function apiKeyRefOf(model: ModelDraft): string {
  const ref = model.apiKeyEnv.trim()
  return ref === '' ? DEFAULT_API_KEY_REF : ref
}

/** Internal edit shape: a persisted row plus its front-end id. */
interface StagedModel extends ModelDraft {
  readonly uid: number
}

/** The settings namespace shape this card edits. */
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

/** The card's full render state. */
export interface GenerationCardState {
  kind: 'image' | 'video'
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  models: ModelRow[]
  defaultKey: string
  /** API-key input text keyed by credential reference (shared across rows). */
  apiKeyTexts: Record<string, string>
}

/** Face the card's slot entry injects (hooks + actions). */
export interface GenerationCardFace {
  hooks: {
    generationCard: SnapshotStore<GenerationCardState>
  }
  editModel: (index: number, field: EditableModelField, text: string) => void
  addModel: () => void
  removeModel: (index: number) => void
  setDefault: (index: number) => void
  setApiKey: (ref: string, text: string) => void
  save: () => void
  discard: () => void
}

export type EditableModelField = 'provider' | 'protocol' | 'model' | 'imageToImageModel' | 'baseURL' | 'apiKeyEnv'

const DEFAULT_API_KEY_REF = 'GENERATE_API_KEY'

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Normalize a stored (possibly partial) model entry into a full row. */
function toRow(entry: unknown, uid: number): StagedModel {
  const e = (entry ?? {}) as Record<string, unknown>
  const provider = typeof e.provider === 'string' && e.provider !== '' ? e.provider : DEFAULT_PROVIDER
  return {
    uid,
    provider,
    protocol: textOf(e.protocol),
    model: textOf(e.model),
    imageToImageModel: textOf(e.imageToImageModel),
    baseURL: textOf(e.baseURL),
    apiKeyEnv: textOf(e.apiKeyEnv),
  }
}

/** Read the current settings snapshot into a staged list plus default key. */
function readOriginal(snapshot: SettingsScopeSnapshot<GenerationCardSettings>): {
  models: StagedModel[]
  defaultKey: string
} {
  const value = (snapshot.value ?? {}) as Record<string, unknown>
  let uid = 0
  let models: StagedModel[]
  const stored = value.models
  if (Array.isArray(stored) && stored.length > 0) {
    models = stored.map((entry) => toRow(entry, uid++))
  } else if (typeof value.provider === 'string' && value.provider !== '') {
    models = [toRow({
      provider: value.provider,
      protocol: value.protocol,
      model: value.model,
      imageToImageModel: value.imageToImageModel,
      baseURL: value.baseURL,
      apiKeyEnv: value.apiKeyEnv,
    }, uid++)]
  } else {
    models = [toRow({}, uid++)]
  }
  const defaultKey = typeof value.default === 'string' && value.default !== ''
    ? value.default
    : routeKeyOf(models, 0)
  return { models, defaultKey }
}

/** Strip the front-end uid, leaving only persisted fields. */
function persistOf(model: ModelDraft): ModelDraft {
  return {
    provider: model.provider,
    protocol: model.protocol,
    model: model.model,
    imageToImageModel: model.imageToImageModel,
    baseURL: model.baseURL,
    apiKeyEnv: model.apiKeyEnv,
  }
}

export class GenerateSettingsController {
  private readonly store: SnapshotStore<GenerationCardState>
  private readonly staged: { models: StagedModel[]; defaultKey: string }
  private readonly original: { models: ModelDraft[]; defaultKey: string }
  /** API-key input text, keyed by credential reference (shared across rows). */
  private readonly apiKeys = new Map<string, string>()
  private nextUid = 1
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<GenerationCardSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly kind: 'image' | 'video',
  ) {
    const initial = readOriginal(scope.getSnapshot())
    this.original = {
      models: initial.models.map(persistOf),
      defaultKey: initial.defaultKey,
    }
    this.staged = {
      models: initial.models.map((m) => ({ ...m })),
      defaultKey: initial.defaultKey,
    }
    this.nextUid = initial.models.reduce((max, m) => Math.max(max, m.uid + 1), 1)
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => {
      // An external edit (an agent rewriting settings.yaml directly, or another
      // tab) hot-publishes through the Host and lands here as a fresh snapshot.
      // When the user has no unsaved work, re-read it into `staged` so the next
      // save() writes the LATEST value instead of clobbering the external edit
      // with the stale value captured at construction time.
      if (!this.isDirty() && !this.saving) {
        const latest = readOriginal(this.scope.getSnapshot())
        this.staged.models = latest.models.map((m) => ({ ...m }))
        this.staged.defaultKey = latest.defaultKey
        this.original.models = latest.models.map(persistOf)
        this.original.defaultKey = latest.defaultKey
        this.nextUid = latest.models.reduce((max, m) => Math.max(max, m.uid + 1), 1)
        this.apiKeys.clear()
      }
      this.store.set(this.projection())
    })
  }

  private get presets(): readonly ClientPreset[] {
    return this.kind === 'image' ? IMAGE_PRESETS : VIDEO_PRESETS
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
      models: this.staged.models.map((m) => ({ ...m })),
      defaultKey: this.staged.defaultKey,
      apiKeyTexts: Object.fromEntries(this.apiKeys),
    }
  }

  private isDirty(): boolean {
    return JSON.stringify(this.staged.models.map(persistOf)) !== JSON.stringify(this.original.models)
      || this.staged.defaultKey !== this.original.defaultKey
      || [...this.apiKeys.values()].some((text) => text.trim() !== '')
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  inject(): GenerationCardFace {
    return {
      hooks: { generationCard: this.store },
      editModel: (index, field, text) => {
        const model = this.staged.models[index]
        if (model === undefined) return
        model[field] = text
        if (field === 'provider') {
          const preset = this.presets.find((p) => p.id === text)
          model.apiKeyEnv = preset === undefined ? '' : defaultApiKeyEnvOf(preset)
          // A different provider has a different model namespace; seed the
          // first suggestion and its i2i counterpart instead of keeping a
          // stale model id from the previous provider.
          model.model = preset === undefined ? '' : firstModelOf(preset)
          model.imageToImageModel = preset === undefined || model.model === '' ? '' : i2iModelOf(preset, model.model)
        } else if (field === 'model') {
          const preset = this.presets.find((p) => p.id === model.provider)
          model.imageToImageModel = preset === undefined ? '' : i2iModelOf(preset, text)
        }
        this.failed = false
        this.publish()
      },
      addModel: () => {
        this.staged.models.push({
          uid: this.nextUid++,
          provider: DEFAULT_PROVIDER,
          protocol: '',
          model: '',
          imageToImageModel: '',
          baseURL: '',
          apiKeyEnv: '',
        })
        this.failed = false
        this.publish()
      },
      removeModel: (index) => {
        if (this.staged.models.length <= 1) return
        this.staged.models.splice(index, 1)
        this.failed = false
        this.publish()
      },
      setDefault: (index) => {
        const model = this.staged.models[index]
        if (model === undefined) return
        this.staged.defaultKey = routeKeyOf(this.staged.models, index)
        this.failed = false
        this.publish()
      },
      setApiKey: (ref, text) => {
        this.apiKeys.set(ref, text)
        this.failed = false
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        if (!this.isDirty()) return
        const initial = readOriginal(this.scope.getSnapshot())
        this.staged.models = initial.models.map((m) => ({ ...m }))
        this.staged.defaultKey = initial.defaultKey
        this.apiKeys.clear()
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

    const persisted = this.staged.models.map(persistOf)
    const modelsChanged = JSON.stringify(persisted) !== JSON.stringify(this.original.models)
    const defaultChanged = this.staged.defaultKey !== this.original.defaultKey

    let landed = true
    try {
      if (modelsChanged) {
        await this.scope.set('models', persisted)
        // Drop the legacy flat fields so the Host never falls back to them.
        await this.scope.unset('provider')
        await this.scope.unset('protocol')
        await this.scope.unset('model')
        await this.scope.unset('baseURL')
        await this.scope.unset('apiKeyEnv')
      }
      if (defaultChanged) {
        await this.scope.set('default', this.staged.defaultKey)
      }
      for (const [ref, text] of this.apiKeys) {
        if (text.trim() === '') continue
        await this.api.credentials.set({ ref, value: text.trim() })
      }
    } catch {
      landed = false
    }

    if (landed) {
      this.original.models = persisted
      this.original.defaultKey = this.staged.defaultKey
      this.apiKeys.clear()
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }
}

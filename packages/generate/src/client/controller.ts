/**
 * Staged form model behind one generation card. Self-contained (the reference
 * ui-settings-plugins exports only types), trimmed to the fields a generation
 * card edits: provider/model/baseURL/apiKeyEnv in the settings namespace, plus
 * the API key written through the credentials domain so its literal never
 * rides a response.
 */
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SettingsScope,
  SettingsScopeSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The settings fields this card edits. */
export interface GenerationCardSettings {
  provider?: string
  model?: string
  baseURL?: string
  apiKeyEnv?: string
}

/** One section field's draft state. */
export interface FieldState {
  text: string
  overridden: boolean
}

/** One credential reference's reported state. */
export interface CredentialState {
  configured: boolean
  writable: boolean
}

/** The card's full render state. */
export interface GenerationCardState {
  kind: 'image' | 'video'
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  provider: FieldState
  model: FieldState
  baseURL: FieldState
  apiKeyEnv: FieldState
  apiKey: FieldState
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
}

/** Face the card's slot entry injects (hooks + actions). */
export interface GenerationCardFace {
  hooks: {
    generationCard: SnapshotStore<GenerationCardState>
  }
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

const DEFAULT_API_KEY_REF = 'GENERATE_API_KEY'
const FIELD_KEYS = ['provider', 'model', 'baseURL', 'apiKeyEnv'] as const
const API_KEY_FIELD = 'apiKey'

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The credential reference the card addresses (explicit env ref or default). */
function refOf(snapshot: SettingsScopeSnapshot<GenerationCardSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}

export class GenerateSettingsController {
  private readonly staged = new Map<string, { text: string; clear: boolean }>()
  private readonly store: SnapshotStore<GenerationCardState>
  private credential: CredentialState = { configured: false, writable: true }
  private credentialRef = ''
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<GenerationCardSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly kind: 'image' | 'video',
  ) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): GenerationCardState {
    const snapshot = this.scope.getSnapshot()
    const plan = [...this.staged.entries()].filter(([, e]) => e.text.trim() !== '' || e.clear)
    const base: Record<string, unknown> = (snapshot.base ?? {}) as Record<string, unknown>
    const user: Record<string, unknown> = (snapshot.user ?? {}) as Record<string, unknown>
    const value: Record<string, unknown> = (snapshot.value ?? {}) as unknown as Record<string, unknown>

    const field = (key: string): FieldState => {
      const staged = this.staged.get(key)
      if (staged !== undefined) {
        return { text: staged.text, overridden: !staged.clear }
      }
      return { text: textOf(value[key]), overridden: Object.hasOwn(user, key) }
    }

    return {
      kind: this.kind,
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      saving: this.saving,
      failed: this.failed,
      provider: field('provider'),
      model: field('model'),
      baseURL: field('baseURL'),
      apiKeyEnv: field('apiKeyEnv'),
      apiKey: { text: this.staged.get(API_KEY_FIELD)?.text ?? '', overridden: false },
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  inject(): GenerationCardFace {
    return {
      hooks: { generationCard: this.store },
      edit: (field, text) => { this.staged.set(field, { text, clear: false }); this.failed = false; this.publish() },
      resetField: (field) => { this.staged.set(field, { text: textOf((this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]), clear: true }); this.publish() },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  private async save(): Promise<void> {
    const plan = [...this.staged.entries()].filter(([, e]) => e.text.trim() !== '' || e.clear)
    if (plan.length === 0 || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()

    let landed = true
    for (const [field, edit] of plan) {
      try {
        if (field === API_KEY_FIELD) {
          await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value: edit.text.trim() })
        } else if (edit.clear) {
          await this.scope.unset(field)
        } else {
          await this.scope.set(field, edit.text.trim())
        }
      } catch {
        landed = false
      }
    }

    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    await this.readCredential()
    this.publish()
  }

  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credentialRef) {
      this.credentialRef = ref
      this.credential = { configured: false, writable: true }
      this.publish()
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch {
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    this.credential = {
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    this.publish()
  }
}

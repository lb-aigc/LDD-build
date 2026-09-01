/**
 * Pure routing logic for multi-model generation. Kept dependency-light (no
 * cordis / dsh-tools) so `tests/routing.verify.ts` can exercise it directly
 * under the Node strip-only verify harness.
 */
import { DEFAULT_API_KEY_REF, environmentSecretResolver } from './credentials.ts'
import type { SecretResolver } from './credentials.ts'
import { CUSTOM_PROVIDER_ID, findPreset, presetIds } from './presets.ts'
import type { ProviderPreset } from './presets.ts'
import type { GenerationProvider } from './provider.ts'
import { createProvider } from './providers/index.ts'
import { DEFAULT_PROVIDER } from './settings.ts'
import type { GenerationSettings } from './settings.ts'

/** One resolved model the agent can route to, keyed by a stable routing id. */
export interface RoutedModel {
  /** Routing key the agent names in the `provider` tool argument. */
  key: string
  /** Provider preset id (or `custom`), resolved to a concrete adapter. */
  provider: string
  protocol: string
  model: string
  baseURL: string
  apiKeyEnv: string
  /** Model id for image-to-image; blank falls back to `model`. */
  imageToImageModel: string
}

/** The full routing view for one generation half. */
export interface ResolvedModels {
  entries: RoutedModel[]
  defaultKey: string
}

/** Loose entry shape — a list row and the legacy flat fields both assign here. */
interface RawEntry {
  provider?: string
  protocol?: string
  model?: string
  baseURL?: string
  apiKeyEnv?: string
  imageToImageModel?: string
}

/**
 * Stable routing key for one list entry. The preset id is the key; when the
 * same preset id appears multiple times (two `custom` entries, say), later
 * duplicates get a `#n` suffix so every entry stays addressable. `default`
 * stores this key, so it survives add/remove/reorder of other rows.
 */
export function routeKeyOf(raws: readonly RawEntry[], index: number): string {
  const provider = raws[index]?.provider || DEFAULT_PROVIDER
  const prior = raws
    .slice(0, index)
    .filter((m) => (m.provider || DEFAULT_PROVIDER) === provider).length
  return prior === 0 ? provider : `${provider}#${prior + 1}`
}

/**
 * Turn raw settings into a routing view. Order matters (the card list order is
 * the preference order). A configured `models` array wins; the legacy flat
 * fields upgrade to a single-entry list; empty/unset falls back to one mock
 * entry so the tools stay functional headless.
 *
 * An AGGREGATOR entry (a preset with `models`) expands into one routable model
 * per capability, keyed `provider:modelId`, so a single key reaches every
 * model and the composer lists them all. Non-aggregators stay one-entry-one-
 * model keyed by the legacy `routeKeyOf` rule (`provider` / `provider#n`).
 */
export function resolveModels(
  raw: GenerationSettings | undefined,
  presets: readonly ProviderPreset[],
): ResolvedModels {
  let raws: RawEntry[]
  if (Array.isArray(raw?.models) && raw.models.length > 0) {
    raws = raw.models
  } else if (raw?.provider !== undefined && raw.provider !== '') {
    raws = [{ ...raw }]
  } else {
    raws = [{ provider: DEFAULT_PROVIDER }]
  }
  const entries: RoutedModel[] = []
  const seenKeys = new Set<string>()
  raws.forEach((entry, index) => {
    const provider = entry.provider || DEFAULT_PROVIDER
    const preset = findPreset(presets, provider)
    const models = preset === undefined || provider === CUSTOM_PROVIDER_ID ? undefined : preset.models
    if (models !== undefined && models.length > 0) {
      for (const capability of models) {
        const key = `${provider}:${capability.id}`
        if (seenKeys.has(key)) continue // de-dupe across repeated same-provider entries
        seenKeys.add(key)
        entries.push({
          key,
          provider,
          protocol: entry.protocol ?? '',
          model: capability.id,
          baseURL: entry.baseURL ?? '',
          apiKeyEnv: entry.apiKeyEnv ?? '',
          imageToImageModel: capability.i2iModel ?? '',
        })
      }
    } else {
      const key = routeKeyOf(raws, index)
      seenKeys.add(key)
      entries.push({
        key,
        provider,
        protocol: entry.protocol ?? '',
        model: entry.model ?? '',
        baseURL: entry.baseURL ?? '',
        apiKeyEnv: entry.apiKeyEnv ?? '',
        imageToImageModel: entry.imageToImageModel ?? '',
      })
    }
  })
  const first = entries[0]
  const defaultKey = resolveDefaultKey(raws, entries, raw?.default, presets) ?? first?.key ?? DEFAULT_PROVIDER
  return { entries, defaultKey }
}

/** Resolve the settings `default` into a concrete routing key, tolerating the
 *  old provider-level form (`kie`) by mapping it to the entry's default model. */
function resolveDefaultKey(
  raws: readonly RawEntry[],
  entries: readonly RoutedModel[],
  rawDefault: string | undefined,
  presets: readonly ProviderPreset[],
): string | undefined {
  if (rawDefault === undefined || rawDefault === '') return undefined
  if (entries.some((entry) => entry.key === rawDefault)) return rawDefault
  // Legacy provider-level default: map `kie` → `kie:<that entry's model>`.
  const hit = raws.find((entry) => (entry.provider || DEFAULT_PROVIDER) === rawDefault)
  if (hit === undefined) return undefined
  const provider = hit.provider || DEFAULT_PROVIDER
  const preset = findPreset(presets, provider)
  if (preset?.models !== undefined && preset.models.length > 0 && provider !== CUSTOM_PROVIDER_ID) {
    const modelId = hit.model || preset.defaultModel || preset.models[0]!.id
    return `${provider}:${modelId}`
  }
  return rawDefault
}

/**
 * Resolve a routing key (the `provider` tool argument) to a concrete adapter.
 * `undefined` requested → the default entry; an unknown key is a model-visible
 * error listing the available keys, so a stale tool call fails informatively.
 * The API key is resolved from its reference per call (async: the credentials
 * service may read the store / .env).
 */
export async function buildProvider(
  entry: RoutedModel,
  presets: readonly ProviderPreset[],
  resolveSecret: SecretResolver = environmentSecretResolver,
): Promise<GenerationProvider> {
  if (entry.provider === CUSTOM_PROVIDER_ID) {
    if (entry.protocol === '') {
      throw new Error('provider "custom" 需要配置 protocol（请在设置里配置 protocol）')
    }
    return createProvider(entry.protocol, {
      baseURL: entry.baseURL,
      model: entry.model,
      apiKey: await resolveSecret(entry.apiKeyEnv === '' ? DEFAULT_API_KEY_REF : entry.apiKeyEnv),
      imageToImageModel: entry.imageToImageModel,
    })
  }
  const preset = findPreset(presets, entry.provider)
  if (preset === undefined) {
    throw new Error(
      `unknown generation provider "${entry.provider}" (available: ${presetIds(presets).join(', ')})`,
    )
  }
  return createProvider(preset.protocol, {
    baseURL: entry.baseURL || preset.defaultBaseURL,
    model: entry.model || preset.defaultModel,
    apiKey: await resolveSecret(entry.apiKeyEnv === '' ? DEFAULT_API_KEY_REF : entry.apiKeyEnv),
    imageToImageModel: entry.imageToImageModel,
  })
}

/** Pick the routed model for a call; unknown requested key fails informatively. */
export function pickProvider(resolved: ResolvedModels, requested: string | undefined): RoutedModel {
  if (requested !== undefined && requested !== '') {
    const hit = resolved.entries.find(
      (entry) => entry.key === requested || entry.provider === requested,
    )
    if (hit !== undefined) return hit
    throw new Error(
      `unknown generation provider "${requested}" (available: ${resolved.entries.map((e) => e.key).join(', ')})`,
    )
  }
  const hit = resolved.entries.find((entry) => entry.key === resolved.defaultKey)
  if (hit !== undefined) return hit
  const first = resolved.entries[0]
  if (first !== undefined) return first
  throw new Error('no generation model configured')
}

/**
 * Human routing catalog injected into the tool description so the agent can
 * auto-route without the user switching models. One line per configured model:
 * its key, its human label, and its strengths (the preset's `strengths`).
 */
export function modelCatalog(resolved: ResolvedModels, presets: readonly ProviderPreset[]): string {
  return resolved.entries.map((entry) => {
    const preset = findPreset(presets, entry.provider)
    const baseLabel = entry.provider === CUSTOM_PROVIDER_ID
      ? `custom (${entry.protocol})`
      : (preset?.label ?? entry.provider)
    // Aggregators (KIE) expose many models under one provider. Name the
    // CONCRETE model so the agent can route to a specific one by prompt or
    // skill; an unknown id falls back to the raw id verbatim.
    const modelLabel = entry.model === ''
      ? ''
      : (preset?.models?.find((m) => m.id === entry.model)?.label ?? entry.model)
    const label = modelLabel === '' ? baseLabel : `${baseLabel} · ${modelLabel}`
    const strengths = preset?.strengths ?? ''
    const isDefault = entry.key === resolved.defaultKey
    const i2i = preset === undefined
      ? ''
      : (preset.imageToImage ? ' · 支持图生图' : ' · 仅文生图')
    return `- ${entry.key}${isDefault ? ' (default)' : ''}: ${label}${strengths !== '' ? ` — ${strengths}` : ''}${i2i}`
  }).join('\n')
}

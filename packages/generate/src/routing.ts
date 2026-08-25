/**
 * Pure routing logic for multi-model generation. Kept dependency-light (no
 * cordis / dsh-tools) so `tests/routing.verify.ts` can exercise it directly
 * under the Node strip-only verify harness.
 */
import { environmentSecretResolver } from './credentials.ts'
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
 */
export function resolveModels(raw: GenerationSettings | undefined): ResolvedModels {
  let raws: RawEntry[]
  if (Array.isArray(raw?.models) && raw.models.length > 0) {
    raws = raw.models
  } else if (raw?.provider !== undefined && raw.provider !== '') {
    raws = [{ ...raw }]
  } else {
    raws = [{ provider: DEFAULT_PROVIDER }]
  }
  const entries: RoutedModel[] = raws.map((entry, index) => ({
    key: routeKeyOf(raws, index),
    provider: entry.provider || DEFAULT_PROVIDER,
    protocol: entry.protocol ?? '',
    model: entry.model ?? '',
    baseURL: entry.baseURL ?? '',
    apiKeyEnv: entry.apiKeyEnv ?? '',
  }))
  const first = entries[0]
  const defaultKey = entries.some((entry) => entry.key === raw?.default)
    ? (raw?.default as string)
    : (first?.key ?? DEFAULT_PROVIDER)
  return { entries, defaultKey }
}

/**
 * Resolve a routing key (the `provider` tool argument) to a concrete adapter.
 * `undefined` requested → the default entry; an unknown key is a model-visible
 * error listing the available keys, so a stale tool call fails informatively.
 */
export function buildProvider(entry: RoutedModel, presets: readonly ProviderPreset[]): GenerationProvider {
  if (entry.provider === CUSTOM_PROVIDER_ID) {
    if (entry.protocol === '') {
      throw new Error('provider "custom" 需要配置 protocol（请在设置里配置 protocol）')
    }
    return createProvider(entry.protocol, {
      baseURL: entry.baseURL,
      model: entry.model,
      apiKey: environmentSecretResolver(entry.apiKeyEnv),
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
    apiKey: environmentSecretResolver(entry.apiKeyEnv),
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
    const label = entry.provider === CUSTOM_PROVIDER_ID
      ? `custom (${entry.protocol})`
      : (preset?.label ?? entry.provider)
    const strengths = preset?.strengths ?? ''
    const isDefault = entry.key === resolved.defaultKey
    return `- ${entry.key}${isDefault ? ' (default)' : ''}: ${label}${strengths !== '' ? ` — ${strengths}` : ''}`
  }).join('\n')
}

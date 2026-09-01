import assert from 'node:assert/strict'
import test from 'node:test'

import { CUSTOM_PROVIDER_ID, IMAGE_PROVIDER_PRESETS } from '../src/presets.ts'
import {
  buildProvider,
  modelCatalog,
  pickProvider,
  resolveModels,
  routeKeyOf,
} from '../src/routing.ts'

const P = IMAGE_PROVIDER_PRESETS

test('empty settings resolve to a single mock entry', () => {
  const resolved = resolveModels(undefined, P)
  assert.equal(resolved.entries.length, 1)
  assert.equal(resolved.entries[0]?.key, 'mock')
  assert.equal(resolved.entries[0]?.provider, 'mock')
  assert.equal(resolved.defaultKey, 'mock')
})

test('a configured models list becomes routable entries in order', () => {
  const resolved = resolveModels({
    models: [
      { provider: 'seedream', model: 'seedream-4.0' },
      { provider: 'gpt-image' },
    ],
    default: 'gpt-image',
  }, P)
  assert.equal(resolved.entries.length, 2)
  assert.equal(resolved.entries[0]?.key, 'seedream')
  assert.equal(resolved.entries[1]?.key, 'gpt-image')
  assert.equal(resolved.defaultKey, 'gpt-image')
})

test('duplicate provider ids get a #n suffix so each stays addressable', () => {
  const resolved = resolveModels({
    models: [
      { provider: 'custom', protocol: 'openai-compatible' },
      { provider: 'custom', protocol: 'gemini' },
    ],
  }, P)
  assert.deepEqual(resolved.entries.map((e) => e.key), ['custom', 'custom#2'])
  assert.equal(resolved.defaultKey, 'custom')
})

test('legacy flat fields upgrade to a single-entry list', () => {
  const resolved = resolveModels({
    provider: 'seedream',
    model: 'seedream-4.0',
    baseURL: 'https://example.test/v3',
    apiKeyEnv: 'SEEDREAM_KEY',
  }, P)
  assert.equal(resolved.entries.length, 1)
  assert.equal(resolved.entries[0]?.provider, 'seedream')
  assert.equal(resolved.entries[0]?.model, 'seedream-4.0')
  assert.equal(resolved.entries[0]?.baseURL, 'https://example.test/v3')
  assert.equal(resolved.defaultKey, 'seedream')
})

test('an aggregator entry expands into one routable model per capability', () => {
  const resolved = resolveModels({
    models: [{ provider: 'kie' }],
  }, P)
  const kieModels = P.find((p) => p.id === 'kie')!.models!
  assert.equal(resolved.entries.length, kieModels.length)
  assert.equal(resolved.entries[0]?.key, 'kie:gpt-image-2-text-to-image')
  assert.equal(resolved.entries[0]?.model, 'gpt-image-2-text-to-image')
  // The default is the preset's first capability.
  assert.equal(resolved.defaultKey, 'kie:gpt-image-2-text-to-image')
})

test('a legacy provider-level default maps to the concrete model key', () => {
  const resolved = resolveModels({
    models: [{ provider: 'kie', model: 'flux-2/pro-text-to-image' }],
    default: 'kie',
  }, P)
  assert.equal(resolved.defaultKey, 'kie:flux-2/pro-text-to-image')
})

test('a concrete default key survives unchanged', () => {
  const resolved = resolveModels({
    models: [{ provider: 'kie' }],
    default: 'kie:z-image',
  }, P)
  assert.equal(resolved.defaultKey, 'kie:z-image')
})

test('pickProvider falls back to the default entry when no key is given', () => {
  const resolved = resolveModels({
    models: [{ provider: 'gpt-image' }, { provider: 'nano-banana' }],
    default: 'nano-banana',
  }, P)
  const picked = pickProvider(resolved, undefined)
  assert.equal(picked.key, 'nano-banana')
})

test('pickProvider routes by key and rejects an unknown key with the available list', () => {
  const resolved = resolveModels({
    models: [{ provider: 'gpt-image' }, { provider: 'seedream' }],
  }, P)
  assert.equal(pickProvider(resolved, 'seedream').provider, 'seedream')
  assert.throws(
    () => pickProvider(resolved, 'does-not-exist'),
    /unknown generation provider "does-not-exist" \(available: gpt-image, seedream\)/,
  )
})

test('pickProvider routes an aggregator capability by its concrete key', () => {
  const resolved = resolveModels({ models: [{ provider: 'kie' }] }, P)
  const picked = pickProvider(resolved, 'kie:flux-2/pro-text-to-image')
  assert.equal(picked.model, 'flux-2/pro-text-to-image')
  assert.equal(picked.imageToImageModel, 'flux-2/pro-image-to-image')
})

test('routeKeyOf matches resolveModels keys', () => {
  const raws = [{ provider: 'a' }, { provider: 'a' }, { provider: 'b' }]
  assert.deepEqual([0, 1, 2].map((i) => routeKeyOf(raws, i)), ['a', 'a#2', 'b'])
})

test('buildProvider maps a preset id to its protocol adapter', async () => {
  const resolved = resolveModels({ models: [{ provider: 'gpt-image' }] }, P)
  const provider = await buildProvider(resolved.entries[0]!, IMAGE_PROVIDER_PRESETS)
  assert.equal(provider.id, 'openai-compatible')
})

test('buildProvider on custom requires a protocol', async () => {
  const resolved = resolveModels({ models: [{ provider: CUSTOM_PROVIDER_ID, protocol: '' }] }, P)
  await assert.rejects(
    buildProvider(resolved.entries[0]!, IMAGE_PROVIDER_PRESETS),
    /provider "custom" 需要配置 protocol/,
  )
})

test('modelCatalog marks the default and lists strengths', () => {
  const resolved = resolveModels({
    models: [{ provider: 'gpt-image' }, { provider: 'seedream' }],
    default: 'seedream',
  }, P)
  const catalog = modelCatalog(resolved, IMAGE_PROVIDER_PRESETS)
  assert.match(catalog, /gpt-image: GPT Image/)
  assert.match(catalog, /seedream \(default\): Seedream/)
})

test('modelCatalog names each concrete KIE model so the agent can route by name', () => {
  const resolved = resolveModels({ models: [{ provider: 'kie' }] }, P)
  const catalog = modelCatalog(resolved, IMAGE_PROVIDER_PRESETS)
  assert.match(catalog, /kie:gpt-image-2-text-to-image \(default\): KIE（聚合中转） · GPT Image 2（文生图 \+ 图生图）/)
  assert.match(catalog, /kie:flux-2\/pro-text-to-image: KIE（聚合中转） · Flux-2 Pro（文生图 \+ 图生图）/)
  assert.match(catalog, /kie:z-image: KIE（聚合中转） · Z-image（文生图）/)
})

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

test('empty settings resolve to a single mock entry', () => {
  const resolved = resolveModels(undefined)
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
  })
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
  })
  assert.deepEqual(resolved.entries.map((e) => e.key), ['custom', 'custom#2'])
  // Default falls back to the first entry when none is named.
  assert.equal(resolved.defaultKey, 'custom')
})

test('legacy flat fields upgrade to a single-entry list', () => {
  const resolved = resolveModels({
    provider: 'seedream',
    model: 'seedream-4.0',
    baseURL: 'https://example.test/v3',
    apiKeyEnv: 'SEEDREAM_KEY',
  })
  assert.equal(resolved.entries.length, 1)
  assert.equal(resolved.entries[0]?.provider, 'seedream')
  assert.equal(resolved.entries[0]?.model, 'seedream-4.0')
  assert.equal(resolved.entries[0]?.baseURL, 'https://example.test/v3')
  assert.equal(resolved.defaultKey, 'seedream')
})

test('pickProvider falls back to the default entry when no key is given', () => {
  const resolved = resolveModels({
    models: [{ provider: 'gpt-image' }, { provider: 'nano-banana' }],
    default: 'nano-banana',
  })
  const picked = pickProvider(resolved, undefined)
  assert.equal(picked.key, 'nano-banana')
})

test('pickProvider routes by key and rejects an unknown key with the available list', () => {
  const resolved = resolveModels({
    models: [{ provider: 'gpt-image' }, { provider: 'seedream' }],
  })
  assert.equal(pickProvider(resolved, 'seedream').provider, 'seedream')
  assert.throws(
    () => pickProvider(resolved, 'does-not-exist'),
    /unknown generation provider "does-not-exist" \(available: gpt-image, seedream\)/,
  )
})

test('routeKeyOf matches resolveModels keys', () => {
  const raws = [{ provider: 'a' }, { provider: 'a' }, { provider: 'b' }]
  assert.deepEqual([0, 1, 2].map((i) => routeKeyOf(raws, i)), ['a', 'a#2', 'b'])
})

test('buildProvider maps a preset id to its protocol adapter', async () => {
  const resolved = resolveModels({ models: [{ provider: 'gpt-image' }] })
  const provider = await buildProvider(resolved.entries[0]!, IMAGE_PROVIDER_PRESETS)
  assert.equal(provider.id, 'openai-compatible')
})

test('buildProvider on custom requires a protocol', async () => {
  const resolved = resolveModels({ models: [{ provider: CUSTOM_PROVIDER_ID, protocol: '' }] })
  await assert.rejects(
    buildProvider(resolved.entries[0]!, IMAGE_PROVIDER_PRESETS),
    /provider "custom" 需要配置 protocol/,
  )
})

test('modelCatalog marks the default and lists strengths', () => {
  const resolved = resolveModels({
    models: [{ provider: 'gpt-image' }, { provider: 'seedream' }],
    default: 'seedream',
  })
  const catalog = modelCatalog(resolved, IMAGE_PROVIDER_PRESETS)
  assert.match(catalog, /gpt-image: GPT Image/)
  assert.match(catalog, /seedream \(default\): Seedream/)
})

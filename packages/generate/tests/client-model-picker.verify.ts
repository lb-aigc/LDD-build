import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePickerModels } from '../src/client/presets.ts'

test('resolvePickerModels expands one KIE entry into every capability', () => {
  const { models, defaultKey } = resolvePickerModels({
    models: [{ provider: 'kie', model: 'gpt-image-2-text-to-image' }],
    default: 'kie',
  } as never)
  // A single KIE key lists ALL its models (11 capabilities), not just the one
  // selected in the settings card.
  assert.equal(models.length, 11)
  assert.equal(models[0]!.key, 'kie:gpt-image-2-text-to-image')
  assert.match(models[0]!.label, /GPT Image 2/)
  assert.match(models[1]!.label, /Nano Banana Pro/)
  // The default resolves from the legacy `kie` form to the concrete key.
  assert.equal(defaultKey, 'kie:gpt-image-2-text-to-image')
  assert.equal(models[0]!.isDefault, true)
})

test('resolvePickerModels falls back to a single mock entry when unset', () => {
  const { models, defaultKey } = resolvePickerModels(undefined)
  assert.equal(models.length, 1)
  assert.equal(models[0]!.key, 'mock')
  assert.equal(defaultKey, 'mock')
})

test('resolvePickerModels honours a concrete default key', () => {
  const { models } = resolvePickerModels({
    models: [{ provider: 'kie' }],
    default: 'kie:z-image',
  } as never)
  const zImage = models.find((m) => m.key === 'kie:z-image')
  assert.equal(zImage?.isDefault, true)
  assert.equal(models[0]!.isDefault, false)
})

test('resolvePickerModels keeps non-aggregators as one entry each', () => {
  const { models } = resolvePickerModels({
    models: [{ provider: 'gpt-image' }, { provider: 'nano-banana' }],
    default: 'nano-banana',
  } as never)
  assert.deepEqual(models.map((m) => m.key), ['gpt-image', 'nano-banana'])
  assert.equal(models[1]!.isDefault, true)
})

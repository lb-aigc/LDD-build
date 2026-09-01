import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePickerModels } from '../src/client/presets.ts'

test('resolvePickerModels lists each configured model with a routing key', () => {
  const { models, defaultKey } = resolvePickerModels({
    models: [
      { provider: 'kie', model: 'gpt-image-2-text-to-image' },
      { provider: 'kie', model: 'flux-2/pro-text-to-image' },
      { provider: 'kie', model: 'z-image' },
    ],
    default: 'kie',
  } as never)
  assert.equal(models.length, 3)
  assert.deepEqual(models.map((m) => m.key), ['kie', 'kie#2', 'kie#3'])
  // Concrete model labels, not three identical "KIE" rows.
  assert.match(models[0]!.label, /GPT Image 2/)
  assert.match(models[1]!.label, /Flux-2 Pro/)
  assert.match(models[2]!.label, /Z-image/)
  assert.equal(defaultKey, 'kie')
  assert.equal(models[0]!.isDefault, true)
})

test('resolvePickerModels falls back to a single mock entry when unset', () => {
  const { models, defaultKey } = resolvePickerModels(undefined)
  assert.equal(models.length, 1)
  assert.equal(models[0]!.key, 'mock')
  assert.equal(defaultKey, 'mock')
})

test('resolvePickerModels honours an explicit default key', () => {
  const { models } = resolvePickerModels({
    models: [
      { provider: 'kie', model: 'gpt-image-2-text-to-image' },
      { provider: 'kie', model: 'z-image' },
    ],
    default: 'kie#2',
  } as never)
  assert.equal(models[1]!.isDefault, true)
  assert.equal(models[0]!.isDefault, false)
})

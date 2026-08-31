import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_PRESETS,
  VIDEO_PRESETS,
  defaultApiKeyEnvOf,
  firstModelOf,
  i2iModelOf,
} from '../src/client/presets.ts'

function preset(id: string) {
  const found = IMAGE_PRESETS.find((p) => p.id === id)
  assert.ok(found, `missing preset ${id}`)
  return found
}

test('KIE preset presets the KIE_API_KEY reference', () => {
  assert.equal(defaultApiKeyEnvOf(preset('kie')), 'KIE_API_KEY')
})

test('provider presets carry their credential reference', () => {
  assert.equal(defaultApiKeyEnvOf(preset('gpt-image')), 'OPENAI_API_KEY')
  assert.equal(defaultApiKeyEnvOf(preset('nano-banana')), 'GEMINI_API_KEY')
  assert.equal(defaultApiKeyEnvOf(preset('seedream')), 'ARK_API_KEY')
  assert.equal(defaultApiKeyEnvOf(preset('legnext')), 'LEGNEXT_API_KEY')
  // mock has no reference
  assert.equal(defaultApiKeyEnvOf(preset('mock')), '')
})

test('distinct-i2i KIE models auto-route their i2i counterpart', () => {
  const kie = preset('kie')
  assert.equal(i2iModelOf(kie, 'gpt-image-2-text-to-image'), 'gpt-image-2-image-to-image')
  assert.equal(i2iModelOf(kie, 'seedream/5-pro-text-to-image'), 'seedream/5-pro-image-to-image')
  assert.equal(i2iModelOf(kie, 'seedream/5-lite-text-to-image'), 'seedream/5-lite-image-to-image')
  assert.equal(i2iModelOf(kie, 'flux-2/pro-text-to-image'), 'flux-2/pro-image-to-image')
  assert.equal(i2iModelOf(kie, 'flux-2/flex-text-to-image'), 'flux-2/flex-image-to-image')
  assert.equal(i2iModelOf(kie, 'grok-imagine/text-to-image'), 'grok-imagine/image-to-image')
})

test('Z-image is a text-only KIE model (no i2i counterpart)', () => {
  const kie = preset('kie')
  assert.equal(i2iModelOf(kie, 'z-image'), '')
})

test('same-id i2i KIE models (Nano Banana) need no i2i model', () => {
  const kie = preset('kie')
  assert.equal(i2iModelOf(kie, 'nano-banana-pro'), '')
  assert.equal(i2iModelOf(kie, 'nano-banana-2'), '')
  assert.equal(i2iModelOf(kie, 'nano-banana-2-lite'), '')
  // text-only model
  assert.equal(i2iModelOf(kie, 'bytedance/seedream'), '')
  // unknown id
  assert.equal(i2iModelOf(kie, 'not-a-model'), '')
})

test('firstModelOf seeds a fresh provider row', () => {
  assert.equal(firstModelOf(preset('kie')), 'gpt-image-2-text-to-image')
  assert.equal(firstModelOf(preset('mock')), '')
})

test('video KIE preset carries KIE_API_KEY', () => {
  const kie = VIDEO_PRESETS.find((p) => p.id === 'kie')
  assert.ok(kie)
  assert.equal(defaultApiKeyEnvOf(kie), 'KIE_API_KEY')
})

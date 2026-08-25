import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CUSTOM_PROVIDER_ID,
  IMAGE_PROVIDER_PRESETS,
  VIDEO_PROVIDER_PRESETS,
  findPreset,
  presetIds,
} from '../src/presets.ts'
import { createProvider } from '../src/providers/index.ts'

const emptyOptions = { baseURL: '', model: '', apiKey: undefined }

test('image presets offer six real providers plus custom', () => {
  assert.deepEqual(presetIds(IMAGE_PROVIDER_PRESETS), [
    'mock',
    'gpt-image',
    'nano-banana',
    'midjourney',
    'seedream',
    'kie',
    'legnext',
    CUSTOM_PROVIDER_ID,
  ])
})

test('video presets offer mock plus kie', () => {
  assert.deepEqual(presetIds(VIDEO_PROVIDER_PRESETS), ['mock', 'kie', CUSTOM_PROVIDER_ID])
})

test('presets carry the expected protocol and defaults', () => {
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'gpt-image')?.protocol, 'openai-compatible')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'gpt-image')?.defaultModel, 'gpt-image-2')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'nano-banana')?.protocol, 'gemini')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'midjourney')?.protocol, 'midjourney')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'seedream')?.protocol, 'volcengine')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'kie')?.protocol, 'kie')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'kie')?.defaultBaseURL, 'https://api.kie.ai')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'kie')?.defaultModel, 'bytedance/seedream')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'legnext')?.protocol, 'legnext')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'legnext')?.defaultBaseURL, 'https://api.legnext.ai/api')
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'legnext')?.defaultModel, 'v8.2')
  assert.equal(findPreset(VIDEO_PROVIDER_PRESETS, 'kie')?.defaultModel, 'bytedance/seedance-2-5')
})

test('createProvider constructs the matching adapter per protocol', () => {
  assert.equal(createProvider('mock', emptyOptions).id, 'mock')
  assert.equal(createProvider('openai-compatible', emptyOptions).id, 'openai-compatible')
  assert.equal(createProvider('gemini', emptyOptions).id, 'gemini')
  assert.equal(createProvider('midjourney', emptyOptions).id, 'midjourney')
  assert.equal(createProvider('volcengine', emptyOptions).id, 'volcengine')
  assert.equal(createProvider('kie', emptyOptions).id, 'kie')
  assert.equal(createProvider('legnext', emptyOptions).id, 'legnext')
})

test('an unknown protocol throws with the available list', () => {
  assert.throws(
    () => createProvider('nope', emptyOptions),
    /unknown generation protocol "nope" \(available: mock, openai-compatible, gemini, midjourney, volcengine, kie, legnext\)/,
  )
})

test('real adapters fail fast without an API key', async () => {
  const provider = createProvider('openai-compatible', { baseURL: 'https://example.test/v1', model: 'm', apiKey: undefined })
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal),
    /API key/,
  )
})

test('kie fails fast without an API key', async () => {
  const provider = createProvider('kie', { baseURL: 'https://api.kie.ai', model: 'bytedance/seedream', apiKey: undefined })
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal),
    /API key/,
  )
})

test('kie fails fast without a model capability id', async () => {
  const provider = createProvider('kie', { baseURL: 'https://api.kie.ai', model: '', apiKey: 'test-key' })
  await assert.rejects(
    provider.generateVideo({ prompt: 'x', durationSeconds: 5, resolution: '720p', aspectRatio: '9:16' }, new AbortController().signal),
    /模型能力名/,
  )
})

test('legnext fails fast without an API key', async () => {
  const provider = createProvider('legnext', { baseURL: 'https://api.legnext.ai/api', model: 'v8.2', apiKey: undefined })
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal),
    /API key/,
  )
})

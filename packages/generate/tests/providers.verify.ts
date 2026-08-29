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
import { buildText } from '../src/providers/legnext.ts'
import { kieClampResolution, kieMaxResolution } from '../src/providers/kie.ts'
import { aspectRatioToImageSize, resolutionAspectPixels } from '../src/provider.ts'

const emptyOptions = { baseURL: '', model: '', apiKey: 'k', imageToImageModel: '' }

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
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'legnext')?.defaultModel, '8.2')
  assert.equal(findPreset(VIDEO_PROVIDER_PRESETS, 'kie')?.defaultModel, 'bytedance/seedance-2-5')
})

test('image presets declare i2i capability — MJ relays are excluded', () => {
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'gpt-image')?.imageToImage, true)
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'nano-banana')?.imageToImage, true)
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'seedream')?.imageToImage, true)
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'kie')?.imageToImage, true)
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'midjourney')?.imageToImage, false)
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'legnext')?.imageToImage, false)
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
  const provider = createProvider('openai-compatible', { baseURL: 'https://example.test/v1', model: 'm', apiKey: undefined, imageToImageModel: '' })
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal),
    /API key/,
  )
})

test('kie fails fast without an API key', async () => {
  const provider = createProvider('kie', { baseURL: 'https://api.kie.ai', model: 'bytedance/seedream', apiKey: undefined, imageToImageModel: '' })
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal),
    /API key/,
  )
})

test('kie fails fast without a model capability id', async () => {
  const provider = createProvider('kie', { baseURL: 'https://api.kie.ai', model: '', apiKey: 'k', imageToImageModel: '' })
  await assert.rejects(
    provider.generateVideo({ prompt: 'x', durationSeconds: 5, resolution: '720p', aspectRatio: '9:16' }, new AbortController().signal),
    /模型能力名/,
  )
})

test('legnext fails fast without an API key', async () => {
  const provider = createProvider('legnext', { baseURL: 'https://api.legnext.ai/api', model: '8.2', apiKey: undefined, imageToImageModel: '' })
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal),
    /API key/,
  )
})

test('legnext buildText normalizes a v-prefixed version', () => {
  const request = { prompt: 'a lonely landscape', count: 1, size: '1024x1024' as const }
  // `v8.2` (and `V7`) must emit `--v 8.2` / `--v 7` — Legnext rejects the `v` prefix.
  assert.ok(buildText(request, 'v8.2').includes('--v 8.2'))
  assert.ok(buildText(request, 'V7').includes('--v 7'))
  assert.ok(buildText(request, '8.1').includes('--v 8.1'))
  // The blank/`midjourney` sentinel adds no `--v` flag at all.
  assert.ok(!buildText(request, '').includes('--v'))
  assert.ok(!buildText(request, 'midjourney').includes('--v'))
})

test('midjourney rejects image-to-image', async () => {
  const provider = createProvider('midjourney', { baseURL: 'https://x.test', model: '', apiKey: 'k', imageToImageModel: '' })
  await assert.rejects(
    provider.generateImage(
      { prompt: 'x', count: 1, size: '1024x1024', inputImages: ['https://x.test/a.png'] },
      new AbortController().signal,
    ),
    /不支持图生图/,
  )
})

test('legnext rejects image-to-image', async () => {
  const provider = createProvider('legnext', { baseURL: 'https://x.test', model: '8.2', apiKey: 'k', imageToImageModel: '' })
  await assert.rejects(
    provider.generateImage(
      { prompt: 'x', count: 1, size: '1024x1024', inputImages: ['https://x.test/a.png'] },
      new AbortController().signal,
    ),
    /不支持图生图/,
  )
})

test('kie i2i requires a configured imageToImageModel', async () => {
  const provider = createProvider('kie', { baseURL: 'https://api.kie.ai', model: 'bytedance/seedream', apiKey: 'k', imageToImageModel: '' })
  await assert.rejects(
    provider.generateImage(
      { prompt: 'x', count: 1, size: '1024x1024', inputImages: ['https://x.test/a.png'] },
      new AbortController().signal,
    ),
    /imageToImageModel/,
  )
})

test('kie resolution degrades per aspect ratio (4K → 2K → 1K)', () => {
  // Full 4K ratios.
  const fourK = ['16:9', '9:16', '4:3', '3:4', '2:1', '1:2', '21:9']
  for (const ratio of fourK) {
    assert.equal(kieMaxResolution(ratio), '4K')
    assert.equal(kieClampResolution('4K', ratio), '4K')
    assert.equal(kieClampResolution('2K', ratio), '2K')
    assert.equal(kieClampResolution('1K', ratio), '1K')
  }
  // 1:1 cannot reach 4K — degrades to 2K.
  assert.equal(kieMaxResolution('1:1'), '2K')
  assert.equal(kieClampResolution('4K', '1:1'), '2K')
  assert.equal(kieClampResolution('2K', '1:1'), '2K')
  assert.equal(kieClampResolution('1K', '1:1'), '1K')
  // 4:5 / 5:4 / 9:21 (and auto / 3:1 / 1:3) cap at 1K.
  for (const ratio of ['4:5', '5:4', '9:21', '3:1', '1:3', 'auto']) {
    assert.equal(kieMaxResolution(ratio), '1K')
    assert.equal(kieClampResolution('4K', ratio), '1K')
    assert.equal(kieClampResolution('2K', ratio), '1K')
    assert.equal(kieClampResolution('1K', ratio), '1K')
  }
})

test('aspectRatioToImageSize maps ratio orientation to the nearest size', () => {
  assert.equal(aspectRatioToImageSize('16:9'), '1792x1024')
  assert.equal(aspectRatioToImageSize('21:9'), '1792x1024')
  assert.equal(aspectRatioToImageSize('4:3'), '1792x1024')
  assert.equal(aspectRatioToImageSize('9:16'), '1024x1792')
  assert.equal(aspectRatioToImageSize('9:21'), '1024x1792')
  assert.equal(aspectRatioToImageSize('3:4'), '1024x1792')
  assert.equal(aspectRatioToImageSize('1:1'), '1024x1024')
})

test('resolutionAspectPixels returns nominal 4K/2K/1K geometry', () => {
  assert.deepEqual(resolutionAspectPixels('4K', '16:9'), { width: 7282, height: 4096 })
  assert.deepEqual(resolutionAspectPixels('2K', '1:1'), { width: 2048, height: 2048 })
  assert.deepEqual(resolutionAspectPixels('1K', '9:16'), { width: 1024, height: 1820 })
  assert.deepEqual(resolutionAspectPixels('4K', 'bogus'), { width: 4096, height: 4096 })
})

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
import { kieClampResolution, kieDistinctI2iCounterpart, kieDistinctI2iImageField, kieMaxResolution, kieSameModelI2iField } from '../src/providers/kie.ts'
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
  assert.equal(findPreset(IMAGE_PROVIDER_PRESETS, 'kie')?.defaultModel, 'gpt-image-2-text-to-image')
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
    /unknown generation protocol "nope" \(available: mock, openai-compatible, gemini, midjourney, volcengine, kie, legnext, suno\)/,
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

test('kie nano banana series reuses the same model for i2i via inline fields', () => {
  // Nano Banana Pro / 2 take references via `image_input`, 2 Lite via
  // `image_urls` — the SAME model id, so no imageToImageModel is required.
  assert.equal(kieSameModelI2iField('nano-banana-pro'), 'image_input')
  assert.equal(kieSameModelI2iField('nano-banana-2'), 'image_input')
  assert.equal(kieSameModelI2iField('nano-banana-2-lite'), 'image_urls')
  // Distinct i2i capability ids keep the imageToImageModel + input_urls path.
  assert.equal(kieSameModelI2iField('bytedance/seedream'), undefined)
  assert.equal(kieSameModelI2iField('gpt-image-2-text-to-image'), undefined)
  assert.equal(kieSameModelI2iField('flux-2/pro-text-to-image'), undefined)
})

test('kie distinct-i2i models auto-route to their i2i counterpart', () => {
  // GPT Image 2 / Seedream 5 / Flux 2 split t2i and i2i into separate ids;
  // a t2i model picks up its i2i counterpart without manual config.
  assert.equal(kieDistinctI2iCounterpart('gpt-image-2-text-to-image'), 'gpt-image-2-image-to-image')
  assert.equal(kieDistinctI2iCounterpart('seedream/5-pro-text-to-image'), 'seedream/5-pro-image-to-image')
  assert.equal(kieDistinctI2iCounterpart('seedream/5-lite-text-to-image'), 'seedream/5-lite-image-to-image')
  assert.equal(kieDistinctI2iCounterpart('flux-2/pro-text-to-image'), 'flux-2/pro-image-to-image')
  assert.equal(kieDistinctI2iCounterpart('flux-2/flex-text-to-image'), 'flux-2/flex-image-to-image')
  assert.equal(kieDistinctI2iCounterpart('grok-imagine/text-to-image'), 'grok-imagine/image-to-image')
  // Same-model (Nano Banana) and unknown ids have no distinct counterpart.
  assert.equal(kieDistinctI2iCounterpart('nano-banana-pro'), undefined)
  assert.equal(kieDistinctI2iCounterpart('bytedance/seedream'), undefined)
  assert.equal(kieDistinctI2iCounterpart('z-image'), undefined)
})

test('kie distinct-i2i reference field: Grok Imagine uses image_urls, others input_urls', () => {
  // Grok Imagine's image-to-image endpoint takes `image_urls` (documented in
  // its "文件上传要求" section), while GPT Image / Seedream / Flux use `input_urls`.
  assert.equal(kieDistinctI2iImageField('grok-imagine/image-to-image'), 'image_urls')
  assert.equal(kieDistinctI2iImageField('gpt-image-2-image-to-image'), 'input_urls')
  assert.equal(kieDistinctI2iImageField('seedream/5-pro-image-to-image'), 'input_urls')
  assert.equal(kieDistinctI2iImageField('flux-2/pro-image-to-image'), 'input_urls')
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
  assert.deepEqual(resolutionAspectPixels('4K', '16:9'), { width: 3840, height: 2160 })
  assert.deepEqual(resolutionAspectPixels('4K', '9:16'), { width: 2160, height: 3840 })
  assert.deepEqual(resolutionAspectPixels('2K', '1:1'), { width: 2048, height: 2048 })
  assert.deepEqual(resolutionAspectPixels('1K', '9:16'), { width: 576, height: 1024 })
  assert.deepEqual(resolutionAspectPixels('4K', 'bogus'), { width: 3840, height: 3840 })
})

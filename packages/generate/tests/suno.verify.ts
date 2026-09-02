import assert from 'node:assert/strict'
import test from 'node:test'

import { createProvider } from '../src/providers/index.ts'
import type { SunoProvider } from '../src/providers/suno.ts'

const options = { baseURL: 'https://api.kie.ai', model: 'V5_5', apiKey: 'test-key', imageToImageModel: '' }

test('suno adapter constructs and rejects image/video', async () => {
  const provider = createProvider('suno', options)
  assert.equal(provider.id, 'suno')
  await assert.rejects(provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, new AbortController().signal), /不支持文生图/)
  await assert.rejects(provider.generateVideo({ prompt: 'x', durationSeconds: 5, resolution: '720p', aspectRatio: '16:9' }, new AbortController().signal), /不支持生视频/)
})

test('suno fails fast without an API key', async () => {
  const provider = createProvider('suno', { ...options, apiKey: '' })
  await assert.rejects(
    provider.generateMusic({ prompt: 'x', customMode: false, instrumental: false }, new AbortController().signal),
    /API key/,
  )
})

test('suno generateMusic submits and polls the Suno endpoint', async () => {
  const provider = createProvider('suno', options) as SunoProvider
  const requests: Array<{ url: string; init: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init: init ?? {} })
    if (url.includes('/api/v1/generate/record-info')) {
      return new Response(JSON.stringify({
        code: 200,
        data: {
          status: 'SUCCESS',
          response: {
            sunoData: [{
              audio_url: 'https://cdn.example/song.mp3',
              image_url: 'https://cdn.example/cover.jpg',
              title: 'My Song',
              duration: 198.4,
              tags: 'pop, upbeat',
              model_name: 'V5_5',
              prompt: 'a happy song',
            }],
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ code: 200, data: { taskId: 'task-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const result = await provider.generateMusic(
      { prompt: 'a happy song', customMode: false, instrumental: false },
      new AbortController().signal,
    )
    assert.equal(result.music.length, 1)
    assert.equal(result.music[0]!.url, 'https://cdn.example/song.mp3')
    assert.equal(result.music[0]!.title, 'My Song')
    assert.equal(result.music[0]!.durationSeconds, 198.4)
    assert.equal(result.music[0]!.tags, 'pop, upbeat')
    assert.equal(result.music[0]!.coverUrl, 'https://cdn.example/cover.jpg')
    // Submit body is the non-custom shape (only prompt + flags + model).
    const submit = requests.find((r) => r.url.includes('/api/v1/generate') && !r.url.includes('record-info'))
    assert.ok(submit, 'submit request present')
    const body = JSON.parse(String(submit!.init.body))
    assert.equal(body.customMode, false)
    assert.equal(body.instrumental, false)
    assert.equal(body.model, 'V5_5')
    assert.equal(body.prompt, 'a happy song')
    assert.equal(body.style, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('suno custom mode carries style and title', async () => {
  const provider = createProvider('suno', options) as SunoProvider
  const requests: Array<{ url: string; init: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init: init ?? {} })
    if (url.includes('record-info')) {
      return new Response(JSON.stringify({ code: 200, data: { status: 'SUCCESS', response: { sunoData: [{ audio_url: 'https://cdn.example/s.mp3' }] } } }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: 200, data: { taskId: 'task-2' } }), { status: 200 })
  }) as typeof fetch
  try {
    await provider.generateMusic(
      { prompt: '[Verse] hello', customMode: true, instrumental: false, style: 'Pop', title: 'Hello World' },
      new AbortController().signal,
    )
    const submit = requests.find((r) => r.url.includes('/api/v1/generate') && !r.url.includes('record-info'))
    const body = JSON.parse(String(submit!.init.body))
    assert.equal(body.customMode, true)
    assert.equal(body.style, 'Pop')
    assert.equal(body.title, 'Hello World')
    assert.equal(body.prompt, '[Verse] hello')
  } finally {
    globalThis.fetch = originalFetch
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { MockGenerationProvider } from '../src/provider.ts'

const provider = new MockGenerationProvider()

test('generate_image returns the requested variants with parsed dimensions', async () => {
  const result = await provider.generateImage(
    { prompt: 'a cat', count: 3, size: '1024x1792' },
    new AbortController().signal,
  )
  assert.equal(result.provider, 'mock')
  assert.equal(result.model, 'mock-image')
  assert.equal(result.images.length, 3)
  assert.deepEqual(result.images.map((image) => image.index), [0, 1, 2])
  assert.equal(result.images[0]?.width, 1024)
  assert.equal(result.images[0]?.height, 1792)
  assert.equal(result.images[0]?.prompt, 'a cat')
})

test('generate_video returns a single clip with the requested frame', async () => {
  const result = await provider.generateVideo(
    { prompt: 'a walk', durationSeconds: 9, resolution: '1080p', aspectRatio: '9:16' },
    new AbortController().signal,
  )
  assert.equal(result.provider, 'mock')
  assert.equal(result.model, 'mock-video')
  assert.equal(result.videos.length, 1)
  assert.equal(result.videos[0]?.durationSeconds, 9)
  assert.equal(result.videos[0]?.resolution, '1080p')
  assert.equal(result.videos[0]?.aspectRatio, '9:16')
})

test('a cancelled signal aborts before any generation', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    provider.generateImage({ prompt: 'x', count: 1, size: '1024x1024' }, controller.signal),
  )
})

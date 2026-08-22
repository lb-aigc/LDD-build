import assert from 'node:assert/strict'
import test from 'node:test'

import { boundedVisionStream } from '../src/bounded-stream.ts'

test('bounds model chunks before a consumer can accumulate them', async () => {
  async function* oversized() {
    yield { type: 'text-delta', text: 'a'.repeat(700_000) }
    yield { type: 'text-delta', text: 'b'.repeat(700_000) }
  }
  const received: unknown[] = []
  await assert.rejects(async () => {
    for await (const chunk of boundedVisionStream(oversized(), {
      maxBytes: 1024 * 1024,
      maxChunks: 10,
    })) {
      received.push(chunk)
    }
  }, /response limit/)
  assert.equal(received.length, 1)
})

test('also bounds streams made of tiny chunks', async () => {
  async function* noisy() {
    for (let index = 0; index < 4; index += 1) yield { type: 'usage', index }
  }
  await assert.rejects(async () => {
    for await (const _chunk of boundedVisionStream(noisy(), { maxBytes: 1_024, maxChunks: 3 })) {
      // consume
    }
  }, /chunk limit/)
})

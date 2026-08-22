import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveBaseInterval,
  sampleVideo,
} from '../src/sampling.ts'

for (const [duration, expected] of [[29, 1], [30, 3], [300, 3], [301, 10]] as const) {
  test(`uses a ${expected}s base interval for ${duration}s`, () => {
    assert.equal(resolveBaseInterval(duration), expected)
  })
}

test('sampling is sorted, unique, scene-aware, and bounded by 36/144', () => {
  const result = sampleVideo(
    { durationSeconds: 3_600, width: 1920, height: 1080, frameRate: 30, hasAudio: true, format: 'mp4' },
    { startSeconds: 30, endSeconds: 1_830 },
    'high',
    [42.1234, 42.12349, 99],
  )
  assert.ok(result.timestamps.includes(42.123))
  assert.ok(result.timestamps.includes(99))
  assert.equal(new Set(result.timestamps).size, result.timestamps.length)
  assert.deepEqual(result.timestamps, [...result.timestamps].sort((a, b) => a - b))
  assert.ok(result.timestamps.length <= 144)
  assert.ok(result.batches.every((batch) => batch.timestamps.length <= 36))
})

test('video above 60 minutes requires a range no wider than 60 minutes', () => {
  const metadata = { durationSeconds: 7_200, width: 1920, height: 1080, frameRate: 30, hasAudio: false, format: 'mkv' as const }
  assert.throws(() => sampleVideo(metadata, {}, 'balanced'), /60 minutes/)
  assert.doesNotThrow(() => sampleVideo(metadata, { startSeconds: 3_600, endSeconds: 7_200 }, 'balanced'))
  assert.throws(() => sampleVideo(metadata, { startSeconds: 1, endSeconds: 3_602 }, 'balanced'), /60 minutes/)
})

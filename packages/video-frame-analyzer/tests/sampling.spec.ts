import { describe, expect, it } from 'vitest'

import { resolveBaseInterval, sampleVideo } from '../src/sampling.ts'

describe('video sampling', () => {
  it.each([[29, 1], [30, 3], [300, 3], [301, 10]])(
    'uses the specified base interval for %s seconds',
    (duration, interval) => expect(resolveBaseInterval(duration)).toBe(interval),
  )

  it('caps work at 36 frames per batch and 144 total', () => {
    const result = sampleVideo({
      durationSeconds: 3_600,
      width: 1920,
      height: 1080,
      frameRate: 30,
      hasAudio: true,
      format: 'mp4',
    }, {}, 'high')
    expect(result.timestamps.length).toBeLessThanOrEqual(144)
    expect(result.batches.every((batch) => batch.timestamps.length <= 36)).toBe(true)
  })
})

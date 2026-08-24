import { describe, expect, it } from 'vitest'

import { MockGenerationProvider } from '../src/provider.ts'

describe('mock generation provider', () => {
  it('produces self-describing placeholder URLs', async () => {
    const provider = new MockGenerationProvider()
    const result = await provider.generateImage(
      { prompt: '赛博朋克猫', count: 2, size: '1024x1024' },
      new AbortController().signal,
    )
    expect(result.images).toHaveLength(2)
    for (const image of result.images) {
      expect(image.url).toMatch(/^mock-image:\/\//)
      expect(image.prompt).toBe('赛博朋克猫')
    }
  })

  it('echoes the request through the video result', async () => {
    const provider = new MockGenerationProvider()
    const result = await provider.generateVideo(
      { prompt: '海边奔跑', durationSeconds: 10, resolution: '720p', aspectRatio: '16:9' },
      new AbortController().signal,
    )
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]?.durationSeconds).toBe(10)
    expect(result.videos[0]?.aspectRatio).toBe('16:9')
  })
})

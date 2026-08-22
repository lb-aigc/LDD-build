import { describe, expect, it } from 'vitest'

import { analyzeVideo, type VideoAnalyzerDependencies } from '../src/analyzer.ts'
import type { TempMediaContext } from '../src/temp-media.ts'

function fixtureDependencies(events: string[]): VideoAnalyzerDependencies {
  return {
    config: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      defaultPrecision: 'balanced',
      maxTokens: 2_000,
      timeoutMs: 120_000,
    },
    resolveInput: async () => 'C:\\workspace\\clip.mp4',
    probe: async () => ({
      durationSeconds: 15,
      width: 1920,
      height: 1080,
      frameRate: 30,
      hasAudio: true,
      format: 'mp4',
    }),
    prepareVision: async () => ({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      maxTokens: 2_000,
      invoke: async () => {
        events.push('llm/stream')
        return JSON.stringify({
          observations: [{
            startSeconds: 0,
            endSeconds: 15,
            summary: 'A subject crosses the frame.',
            visibleText: [],
            evidenceTimestamps: [4.5, 9.5],
            confidence: 'high',
          }],
          warnings: [],
        })
      },
    }),
    withTemp: async (_taskId, task) => task({
      path: 'C:\\temp\\video-task',
      markerPath: 'C:\\temp\\video-task\\.marker',
      signal: new AbortController().signal,
      trackChild: () => undefined,
    } satisfies TempMediaContext),
    detectScenes: async () => [4.5, 9.5],
    renderContactSheet: async (_path, plan) => { events.push(`sheet:${plan.index}`) },
    decodeWarnings: () => [],
    saveContactSheet: async (_path, name) => ({
      attachmentId: `attachment-${name}`,
      mediaType: 'image/jpeg',
      bytes: 1_024,
      width: 1_552,
      height: 880,
      name,
    }),
    recordInput: (record) => {
      expect(record.route).toEqual({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash-vision-exp',
      })
      events.push('video/analysis-input')
    },
  }
}

describe('analyzeVideo', () => {
  it('records reconstructable input before opening the nested vision stream', async () => {
    const events: string[] = []
    const result = await analyzeVideo({
      path: 'clip.mp4',
      goal: 'Describe scene changes',
    }, new AbortController().signal, fixtureDependencies(events))

    expect(events).toEqual([
      'sheet:0',
      'sheet:1',
      'video/analysis-input',
      'llm/stream',
    ])
    expect(result).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      requestCount: 1,
    })
  })
})

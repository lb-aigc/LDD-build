import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeVideo, type VideoAnalyzerDependencies } from '../src/analyzer.ts'
import type { TempMediaContext } from '../src/temp-media.ts'
import type { VideoImageRef } from '../src/types.ts'

function dependencies(events: string[], visionText: string): VideoAnalyzerDependencies {
  let attachment = 0
  return {
    config: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      defaultPrecision: 'balanced',
      maxTokens: 2_000,
      timeoutMs: 120_000,
    },
    resolveInput: async () => 'C:\\work\\clip.mp4',
    probe: async () => ({
      durationSeconds: 15,
      width: 1920,
      height: 1080,
      frameRate: 30,
      hasAudio: true,
      format: 'mp4',
    }),
    prepareVision: async () => {
      events.push('prepare')
      return {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash-vision-exp',
        maxTokens: 2_000,
        invoke: async () => {
          events.push('vision')
          return visionText
        },
      }
    },
    withTemp: async (_taskId, task) => task({
      path: 'C:\\temp\\task',
      markerPath: 'C:\\temp\\task\\.marker',
      signal: new AbortController().signal,
      trackChild: () => undefined,
    } satisfies TempMediaContext),
    detectScenes: async () => [4.5, 9.5],
    renderContactSheet: async (_input, plan) => {
      events.push(`sheet:${plan.index}`)
    },
    decodeWarnings: () => ['damaged frame recovered'],
    saveContactSheet: async (_path, name) => ({
      attachmentId: `sheet-${attachment += 1}`,
      mediaType: 'image/jpeg',
      bytes: 1_024,
      width: 1_552,
      height: 880,
      name,
    } satisfies VideoImageRef),
    recordInput: (record) => {
      assert.equal(record.route.model, 'deepseek-v4-flash-vision-exp')
      assert.equal(record.contactSheets.length, 2)
      events.push('record')
    },
  }
}

test('records reconstructable input before the nested vision request', async () => {
  const events: string[] = []
  const result = await analyzeVideo({
    path: 'clip.mp4',
    goal: 'Describe scene changes',
  }, new AbortController().signal, dependencies(events, JSON.stringify({
    observations: [{
      startSeconds: 0,
      endSeconds: 15,
      summary: 'A subject crosses the frame.',
      visibleText: [],
      evidenceTimestamps: [4.5, 9.5],
      confidence: 'high',
    }],
    warnings: [],
  })))

  assert.ok(events.indexOf('record') < events.indexOf('vision'))
  assert.deepEqual(events, ['prepare', 'sheet:0', 'sheet:1', 'record', 'vision'])
  assert.equal(result.model, 'deepseek-v4-flash-vision-exp')
  assert.equal(result.requestCount, 1)
  assert.equal(result.observations[0]?.summary, 'A subject crosses the frame.')
  assert.deepEqual(result.coverage, {
    analyzedRange: { startSeconds: 0, endSeconds: 15 },
    uncoveredIntervals: [],
  })
  assert.deepEqual(result.decodeWarnings, ['damaged frame recovered'])
})

test('reports intervals not covered by structured observations', async () => {
  const result = await analyzeVideo({
    path: 'clip.mp4',
    goal: 'Find activity',
  }, new AbortController().signal, dependencies([], JSON.stringify({
    observations: [{
      startSeconds: 5,
      endSeconds: 10,
      summary: 'Activity is visible.',
      visibleText: [],
      evidenceTimestamps: [7],
      confidence: 'medium',
    }],
    warnings: [],
  })))
  assert.deepEqual(result.coverage.uncoveredIntervals, [
    { startSeconds: 0, endSeconds: 5 },
    { startSeconds: 10, endSeconds: 15 },
  ])
})

test('turns malformed provider output into stable bounded evidence', async () => {
  const result = await analyzeVideo({
    path: 'clip.mp4',
    goal: 'Summarize',
  }, new AbortController().signal, dependencies([], 'not json\u0000with control'))
  assert.equal(result.observations.length, 1)
  assert.match(result.observations[0]?.summary ?? '', /unstructured response/i)
  assert.match(result.warnings.join('\n'), /not valid structured JSON/i)
})

test('rejects an unbounded long video before scene detection starts', async () => {
  const events: string[] = []
  const fixture = dependencies(events, '{}')
  const longVideo: VideoAnalyzerDependencies = {
    ...fixture,
    probe: async () => ({
      durationSeconds: 7_200,
      width: 1920,
      height: 1080,
      frameRate: 30,
      hasAudio: true,
      format: 'mp4',
    }),
    detectScenes: async () => {
      events.push('detect-scenes')
      return []
    },
  }
  await assert.rejects(
    analyzeVideo({ path: 'clip.mp4', goal: 'Summarize' }, new AbortController().signal, longVideo),
    /60 minutes/,
  )
  assert.equal(events.includes('detect-scenes'), false)
  assert.equal(events.includes('prepare'), false)
})

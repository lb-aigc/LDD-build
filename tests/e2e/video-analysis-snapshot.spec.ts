import { describe, expect, it } from 'vitest'

import { analyzeVideo, type VideoAnalyzerDependencies } from '../../packages/video-frame-analyzer/src/analyzer.ts'
import type { TempMediaContext } from '../../packages/video-frame-analyzer/src/temp-media.ts'

describe('keyless video-analysis contract snapshot', () => {
  it('keeps the user-visible result stable without a provider key', async () => {
    const dependencies: VideoAnalyzerDependencies = {
      config: {
        provider: 'scripted-vision',
        model: 'fixture-vision',
        defaultPrecision: 'balanced',
        maxTokens: 2_000,
        timeoutMs: 10_000,
      },
      resolveInput: async () => '/fixture/15s.mp4',
      probe: async () => ({
        durationSeconds: 15,
        width: 1280,
        height: 720,
        frameRate: 30,
        hasAudio: false,
        format: 'mp4',
      }),
      assertVisionRoute: async () => undefined,
      withTemp: async (_taskId, task) => task({
        path: '/tmp/fixture',
        markerPath: '/tmp/fixture/.marker',
        signal: new AbortController().signal,
        trackChild: () => undefined,
      } satisfies TempMediaContext),
      detectScenes: async () => [5, 10],
      renderContactSheet: async () => undefined,
      saveContactSheet: async (_path, name) => ({
        attachmentId: name,
        mediaType: 'image/jpeg',
        bytes: 900,
        width: 1200,
        height: 700,
        name,
      }),
      recordInput: () => undefined,
      invokeVision: async () => JSON.stringify({
        observations: [{
          startSeconds: 0,
          endSeconds: 15,
          summary: 'Two scene transitions are visible.',
          visibleText: ['LDD'],
          evidenceTimestamps: [5, 10],
          confidence: 'high',
        }],
        warnings: [],
      }),
    }

    const { analysisId: _analysisId, contactSheets, ...stable } = await analyzeVideo({
      path: '15s.mp4',
      goal: 'Find scene changes and visible text',
    }, new AbortController().signal, dependencies)

    expect({
      ...stable,
      contactSheets: contactSheets.map(({ attachmentId: _attachmentId, name: _name, ...sheet }) => sheet),
    }).toMatchInlineSnapshot(`
      {
        "contactSheets": [
          {
            "bytes": 900,
            "height": 700,
            "mediaType": "image/jpeg",
            "width": 1200,
          },
          {
            "bytes": 900,
            "height": 700,
            "mediaType": "image/jpeg",
            "width": 1200,
          },
        ],
        "metadata": {
          "durationSeconds": 15,
          "format": "mp4",
          "frameRate": 30,
          "hasAudio": false,
          "height": 720,
          "width": 1280,
        },
        "model": "fixture-vision",
        "observations": [
          {
            "confidence": "high",
            "endSeconds": 15,
            "evidenceTimestamps": [
              5,
              10,
            ],
            "startSeconds": 0,
            "summary": "Two scene transitions are visible.",
            "visibleText": [
              "LDD",
            ],
          },
        ],
        "provider": "scripted-vision",
        "requestCount": 1,
        "strategy": {
          "contactSheetCount": 2,
          "frameCount": 15,
          "intervalSeconds": 1,
          "precision": "balanced",
          "truncated": false,
        },
        "warnings": [],
      }
    `)
  })
})

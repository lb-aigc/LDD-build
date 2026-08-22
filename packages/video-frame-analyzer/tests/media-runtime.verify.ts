import assert from 'node:assert/strict'
import test from 'node:test'

import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

import { parseSceneTimestamps, VideoMediaRuntime } from '../src/media-runtime.ts'

test('parses, rounds, sorts, and deduplicates bounded FFmpeg scene timestamps', () => {
  const output = [
    'frame:1 pts_time:9.5004',
    'frame:2 pts_time:4.25',
    'frame:3 pts_time:9.5001',
    'frame:4 pts_time:999999',
  ].join('\n')

  assert.deepEqual(parseSceneTimestamps(output), [4.25, 9.5])
})

test('rejects scene metadata above the bounded parser budget', () => {
  assert.throws(
    () => parseSceneTimestamps('x'.repeat(4 * 1024 * 1024 + 1)),
    /safety limit/i,
  )
})

test('scene detection seeks and bounds FFmpeg to the selected range', async () => {
  let spec: SubprocessSpawnSpec | undefined
  let tracked = 0
  const runtime = new VideoMediaRuntime({
    ffmpegPath: 'C:\\LDD\\ffmpeg.exe',
    sceneThreshold: 0.35,
    stopGraceMs: 3_000,
  }, {
    spawn(value) {
      spec = value
      return {
        pid: 55,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: 'pts_time:2.5', nextOffset: 12, lossy: false }) },
          stderr: { readFrom: () => ({ text: 'damaged frame recovered', nextOffset: 23, lossy: false }) },
        },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate: () => undefined,
        waitForExit: async () => true,
      }
    },
  })
  const timestamps = await runtime.detectScenes(
    'C:\\work\\clip.mp4',
    { startSeconds: 600, endSeconds: 660 },
    {
      path: 'C:\\temp\\task',
      markerPath: 'C:\\temp\\task\\.marker',
      signal: new AbortController().signal,
      trackChild: () => { tracked += 1 },
    },
  )
  assert.deepEqual(timestamps, [602.5])
  assert.deepEqual(spec?.argv.slice(0, 10), [
    'C:\\LDD\\ffmpeg.exe',
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-ss',
    '600',
    '-i',
    'C:\\work\\clip.mp4',
    '-t',
  ])
  assert.equal(spec?.argv[10], '60')
  assert.equal(tracked, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFfprobeOutput } from '../src/media-probe.ts'

test('parses finite video metadata and reports audio', () => {
  const result = parseFfprobeOutput(JSON.stringify({
    format: { duration: '15.25', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio' },
    ],
  }), 'clip.mp4')
  assert.equal(result.durationSeconds, 15.25)
  assert.equal(result.width, 1920)
  assert.equal(result.height, 1080)
  assert.ok(Math.abs(result.frameRate - 29.97002997) < 0.000001)
  assert.equal(result.hasAudio, true)
  assert.equal(result.format, 'mp4')
})

test('rejects empty, unsupported, and unsafe video metadata', () => {
  assert.throws(() => parseFfprobeOutput('{"format":{},"streams":[]}', 'empty.mp4'), /video stream/)
  assert.throws(() => parseFfprobeOutput(JSON.stringify({
    format: { duration: 'NaN', format_name: 'mov,mp4' },
    streams: [{ codec_type: 'video', width: 10, height: 10, avg_frame_rate: '30/1' }],
  }), 'bad.mp4'), /duration/)
  assert.throws(() => parseFfprobeOutput(JSON.stringify({
    format: { duration: '1', format_name: 'avi' },
    streams: [{ codec_type: 'video', width: 10, height: 10, avg_frame_rate: '30/1' }],
  }), 'bad.avi'), /unsupported/)
})

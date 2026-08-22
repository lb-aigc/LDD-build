import { describe, expect, it } from 'vitest'

import { parseFfprobeOutput } from '../src/media-probe.ts'

describe('ffprobe metadata', () => {
  it('parses a finite supported video stream', () => {
    expect(parseFfprobeOutput(JSON.stringify({
      format: { duration: '15', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [{ codec_type: 'video', width: 1280, height: 720, avg_frame_rate: '30/1' }],
    }), 'clip.mp4')).toMatchObject({ durationSeconds: 15, width: 1280, height: 720, frameRate: 30 })
  })
})

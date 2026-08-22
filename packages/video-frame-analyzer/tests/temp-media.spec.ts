import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { withTempMedia } from '../src/temp-media.ts'

describe('temporary media ownership', () => {
  it('awaits child settlement before removing the owned directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ldd-video-spec-'))
    const events: string[] = []
    try {
      await withTempMedia({ cacheRoot: root, taskId: 'test' }, async (media) => {
        media.trackChild({
          stop: async () => { events.push('stop') },
          waitForExit: async () => { events.push('settled') },
        })
      })
      expect(events).toEqual(['stop', 'settled'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

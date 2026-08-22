import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { withTempMedia } from '../src/temp-media.ts'

test('temp-media stops and awaits children before deleting only its random directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ldd-video-temp-'))
  const sibling = join(root, 'do-not-delete')
  await mkdir(sibling)
  const events: string[] = []
  let taskPath = ''
  try {
    await withTempMedia({ cacheRoot: root, taskId: 'task/hostile' }, async (media) => {
      taskPath = media.path
      media.trackChild({
        stop: async () => { events.push('stop') },
        waitForExit: async () => { events.push('settled') },
      })
      events.push('task')
    })
    assert.deepEqual(events, ['task', 'stop', 'settled'])
    await assert.rejects(lstat(taskPath), { code: 'ENOENT' })
    assert.equal((await lstat(sibling)).isDirectory(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('temp-media preserves task files when its ownership marker is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ldd-video-marker-'))
  let taskPath = ''
  try {
    await assert.rejects(
      withTempMedia({ cacheRoot: root, taskId: 'marker-test' }, async (media) => {
        taskPath = media.path
        await rm(media.markerPath)
      }),
      /ownership marker/,
    )
    assert.equal((await lstat(taskPath)).isDirectory(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

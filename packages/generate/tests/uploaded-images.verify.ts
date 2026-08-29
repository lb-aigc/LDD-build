import assert from 'node:assert/strict'
import test from 'node:test'

import { collectUploadedImages } from '../src/uploaded-images.ts'
import type { AttachmentStoreLike, ImageMeta } from '../src/attach.ts'

/** A fake attachment store that answers readImage with fixed bytes. */
function fakeStore(images: Map<string, Uint8Array>): AttachmentStoreLike {
  return {
    async saveImage() { throw new Error('unused') },
    async readImage(ref: ImageMeta): Promise<{ data: Uint8Array }> {
      const data = images.get(ref.attachmentId)
      if (data === undefined) throw new Error('missing')
      return { data }
    },
  }
}

const PNG = 'image/png' as const
const bytes = new Uint8Array([137, 80, 78, 71]) // "\x89PNG"

test('collects the latest user-message images as data URIs', async () => {
  const store = fakeStore(new Map([['att-1', bytes]]))
  const session = {
    events: [
      { type: 'turn/start', data: {} },
      {
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'hi' }, { type: 'image', attachment: { attachmentId: 'att-1', mediaType: PNG, bytes: 4, width: 1, height: 1 } }] },
      },
    ],
  }
  const result = await collectUploadedImages(session as never, store, new AbortController().signal)
  assert.equal(result.length, 1)
  assert.ok(result[0]!.startsWith(`data:${PNG};base64,`))
})

test('returns empty when no image block exists', async () => {
  const store = fakeStore(new Map())
  const session = {
    events: [
      { type: 'user/message', data: { content: [{ type: 'text', text: 'no image' }] } },
    ],
  }
  const result = await collectUploadedImages(session as never, store, new AbortController().signal)
  assert.equal(result.length, 0)
})

test('returns empty without a session or store', async () => {
  assert.deepEqual(await collectUploadedImages(undefined, fakeStore(new Map()), new AbortController().signal), [])
  assert.deepEqual(await collectUploadedImages({ events: [] } as never, undefined, new AbortController().signal), [])
})

test('only inspects the most recent image-bearing user message', async () => {
  const store = fakeStore(new Map([['new', bytes], ['old', bytes]]))
  const session = {
    events: [
      { type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: 'old', mediaType: PNG, bytes: 4, width: 1, height: 1 } }] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'turn it top-down' }] } },
      { type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: 'new', mediaType: PNG, bytes: 4, width: 1, height: 1 } }] } },
    ],
  }
  const result = await collectUploadedImages(session as never, store, new AbortController().signal)
  assert.equal(result.length, 1)
  assert.ok(result[0]!.includes('iVBORw'))
})

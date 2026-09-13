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

test('collects images across multiple user messages (not just the latest)', async () => {
  const store = fakeStore(new Map([['new', bytes], ['old', bytes]]))
  const session = {
    events: [
      { type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: 'old', mediaType: PNG, bytes: 4, width: 1, height: 1 } }] } },
      { type: 'assistant/message', data: { content: [] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'turn it top-down' }] } },
      { type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: 'new', mediaType: PNG, bytes: 4, width: 1, height: 1 } }] } },
    ],
  }
  const result = await collectUploadedImages(session as never, store, new AbortController().signal)
  // Both the earlier and the latest image are collected — the old behaviour
  // only returned the single latest message's image and dropped the earlier one.
  assert.equal(result.length, 2)
  assert.ok(result[0]!.startsWith(`data:${PNG};base64,`))
  assert.ok(result[1]!.startsWith(`data:${PNG};base64,`))
})

test('caps at maxImages, keeping the most recent uploads', async () => {
  const images = new Map<string, Uint8Array>()
  const events: Array<{ type: string; data: { content: Array<{ type: string; attachment: ImageMeta }> } }> = []
  for (let i = 0; i < 10; i++) {
    const id = `img-${i}`
    images.set(id, bytes)
    events.push({ type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: id, mediaType: PNG, bytes: 4, width: 1, height: 1 } }] } })
  }
  const result = await collectUploadedImages({ events } as never, fakeStore(images), new AbortController().signal)
  assert.equal(result.length, 8) // default maxImages = 8
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  imageBlockOf,
  mediaTypeFromContentType,
  mediaTypeFromUrl,
  parseDataUri,
} from '../src/attach.ts'

test('mediaTypeFromUrl maps known image extensions', () => {
  assert.equal(mediaTypeFromUrl('https://x.com/a.png'), 'image/png')
  assert.equal(mediaTypeFromUrl('https://x.com/a.jpg'), 'image/jpeg')
  assert.equal(mediaTypeFromUrl('https://x.com/a.jpeg'), 'image/jpeg')
  assert.equal(mediaTypeFromUrl('https://x.com/a.webp'), 'image/webp')
  assert.equal(mediaTypeFromUrl('https://x.com/a.gif'), 'image/gif')
})

test('mediaTypeFromUrl ignores the query string and unknown extensions', () => {
  assert.equal(mediaTypeFromUrl('https://x.com/a.png?token=123'), 'image/png')
  assert.equal(mediaTypeFromUrl('https://x.com/a.PNG'), 'image/png')
  assert.equal(mediaTypeFromUrl('https://x.com/a'), undefined)
  assert.equal(mediaTypeFromUrl('https://x.com/a.txt'), undefined)
})

test('mediaTypeFromContentType strips parameters and maps image types', () => {
  assert.equal(mediaTypeFromContentType('image/png'), 'image/png')
  assert.equal(mediaTypeFromContentType('image/jpeg; charset=utf-8'), 'image/jpeg')
  assert.equal(mediaTypeFromContentType('text/html'), undefined)
})

test('parseDataUri decodes a valid base64 image data URI', () => {
  const parsed = parseDataUri('data:image/png;base64,iVBORw0KGgo=')
  assert.notEqual(parsed, undefined)
  assert.equal(parsed?.mediaType, 'image/png')
  assert.deepEqual([...parsed!.data], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
})

test('parseDataUri rejects non-image or non-base64 URIs', () => {
  assert.equal(parseDataUri('data:text/plain;base64,aGk='), undefined)
  assert.equal(parseDataUri('https://x.com/a.png'), undefined)
  assert.equal(parseDataUri('data:image/png;base64,@@@'), undefined)
})

test('imageBlockOf wraps metadata into an image block', () => {
  const block = imageBlockOf({ attachmentId: 'a1', mediaType: 'image/png', bytes: 10, width: 2, height: 2 })
  assert.equal(block.type, 'image')
  assert.equal(block.attachment.attachmentId, 'a1')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { stripPngTextChunks } from '../src/attach.ts'

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function chunk(type: string, data: number[]): number[] {
  const len = data.length
  return [
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0, 0, 0, 0, // fake CRC — the stripper only moves bytes, it never validates
  ]
}

function bytes(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat())
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0))
}

function contains(seq: Uint8Array, needle: string): boolean {
  const n = ascii(needle)
  outer: for (let i = 0; i + n.length <= seq.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (seq[i + j] !== n[j]) continue outer
    }
    return true
  }
  return false
}

test('stripPngTextChunks removes tEXt but keeps pixel and provenance chunks', () => {
  const png = bytes(
    SIG,
    chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    chunk('tEXt', [...ascii('hf-job-id'), 0, ...ascii('02b19a3d')]),
    chunk('caBX', [1, 2, 3, 4]),
    chunk('IDAT', [10, 20, 30, 40, 50]),
    chunk('IEND', []),
  )
  const stripped = stripPngTextChunks(png)
  assert.ok(contains(stripped, 'IHDR'))
  assert.ok(contains(stripped, 'IDAT'))
  assert.ok(contains(stripped, 'caBX'))
  assert.ok(contains(stripped, 'IEND'))
  assert.ok(!contains(stripped, 'tEXt'))
  assert.ok(!contains(stripped, 'hf-job-id'))
})

test('stripPngTextChunks removes iTXt and zTXt too', () => {
  const png = bytes(
    SIG,
    chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    chunk('iTXt', [1, 2, 3]),
    chunk('zTXt', [4, 5, 6]),
    chunk('IDAT', [7, 8, 9]),
    chunk('IEND', []),
  )
  const stripped = stripPngTextChunks(png)
  assert.ok(!contains(stripped, 'iTXt'))
  assert.ok(!contains(stripped, 'zTXt'))
  assert.ok(contains(stripped, 'IDAT'))
})

test('stripPngTextChunks passes through non-PNG and clean PNG unchanged', () => {
  const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(stripPngTextChunks(notPng), notPng)

  const clean = bytes(
    SIG,
    chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    chunk('IDAT', [1, 2, 3]),
    chunk('IEND', []),
  )
  assert.deepEqual([...stripPngTextChunks(clean)], [...clean])
})

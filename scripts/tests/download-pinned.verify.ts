import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')

test('pinned downloader retries a transiently unavailable primary source and falls back', async () => {
  const candidate = await import(pathToFileURL(resolve(root, 'scripts/download-pinned.mjs')).href)
    .catch(() => ({})) as Record<string, unknown>
  assert.equal(typeof candidate.downloadPinned, 'function')
  const downloadPinned = candidate.downloadPinned as (
    urls: readonly string[],
    expectedSha256: string,
    destination: string,
    maxBytes: number,
    options: {
      attemptsPerSource: number
      fetchImpl: (url: string, init: RequestInit) => Promise<Response>
      sleepImpl: (milliseconds: number) => Promise<void>
    },
  ) => Promise<void>

  const parent = await mkdtemp(join(tmpdir(), 'ldd-pinned-download-'))
  try {
    const primary = 'https://primary.invalid/ffmpeg.zip'
    const fallback = 'https://fallback.invalid/ffmpeg.zip'
    const payload = Buffer.from('checksum-pinned archive bytes')
    const digest = createHash('sha256').update(payload).digest('hex')
    const calls: string[] = []
    const sleeps: number[] = []
    await downloadPinned([primary, fallback], digest, join(parent, 'ffmpeg.zip'), 1024, {
      attemptsPerSource: 2,
      fetchImpl: async (url) => {
        calls.push(url)
        return url === primary
          ? new Response('temporarily unavailable', { status: 503 })
          : new Response(payload, { status: 200 })
      },
      sleepImpl: async (milliseconds) => { sleeps.push(milliseconds) },
    })

    assert.deepEqual(calls, [primary, primary, fallback])
    assert.deepEqual(sleeps, [1000])
    assert.deepEqual(await readFile(join(parent, 'ffmpeg.zip')), payload)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('FFmpeg runtime source has an official GitHub release fallback with one pinned digest', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'vendor/runtime-sources.json'), 'utf8')) as {
    ffmpeg?: { urls?: unknown; sha256?: unknown }
  }
  assert.deepEqual(manifest.ffmpeg?.urls, [
    'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-essentials_build.zip',
    'https://github.com/GyanD/codexffmpeg/releases/download/9.0.1/ffmpeg-9.0.1-essentials_build.zip',
  ])
  assert.equal(manifest.ffmpeg?.sha256, 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9')
})

import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ATTACHMENT_TTL_MS, pruneExpiredAttachments } from '../src/main/attachment-ttl.js'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('attachment TTL sweeper', () => {
  const temps: string[] = []

  async function makeHome(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ldd-ttl-'))
    temps.push(root)
    return root
  }

  async function touch(path: string, ageMs: number): Promise<void> {
    await writeFile(path, 'x')
    const t = new Date(Date.now() - ageMs)
    await utimes(path, t, t)
  }

  afterEach(async () => {
    for (const t of temps.splice(0)) await rm(t, { recursive: true, force: true })
  })

  it('removes objects and request-images older than the TTL, keeps recent ones', async () => {
    const home = await makeHome()
    const objects = join(home, 'attachments', 'v1', 'objects', 'ab')
    const requests = join(home, 'attachments', 'v1', 'request-images', 'cd')
    await mkdir(objects, { recursive: true })
    await mkdir(requests, { recursive: true })

    const hour = 3600_000
    await touch(join(objects, 'old1'), ATTACHMENT_TTL_MS + hour)
    await touch(join(objects, 'fresh1'), hour)
    await touch(join(requests, 'old2'), ATTACHMENT_TTL_MS + 2 * hour)
    await touch(join(requests, 'fresh2'), 2 * hour)

    const removed = await pruneExpiredAttachments(home)
    expect(removed).toBe(2)
    expect(await exists(join(objects, 'old1'))).toBe(false)
    expect(await exists(join(objects, 'fresh1'))).toBe(true)
    expect(await exists(join(requests, 'old2'))).toBe(false)
    expect(await exists(join(requests, 'fresh2'))).toBe(true)
  })

  it('is a no-op when the attachments root is missing', async () => {
    const home = await makeHome()
    await expect(pruneExpiredAttachments(home)).resolves.toBe(0)
  })
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.js'
import {
  renderManagedImagePatch,
  resolveImageConfig,
} from '../src/main/profile/image-mode.js'
import { writeManagedImagePatch } from '../src/main/profile/write-managed-patch.js'
import {
  createDefaultLddSettings,
  readLddSettings,
  writeLddSettings,
} from '../src/main/settings.js'

describe('LDD image modes', () => {
  it('large mode changes only source bytes and compression concurrency', () => {
    const standard = resolveImageConfig('standard')
    const large = resolveImageConfig('large')

    expect({
      ...large,
      maxImageBytes: standard.maxImageBytes,
      imageCompressionConcurrency: standard.imageCompressionConcurrency,
    }).toEqual(standard)
    expect(large.maxImageBytes).toBe(64 * 1024 * 1024)
    expect(large.imageCompressionConcurrency).toBe(1)
  })

  it('renders deterministic complete attachment config without credentials', () => {
    const first = renderManagedImagePatch('standard')
    const second = renderManagedImagePatch('standard')
    expect(first).toBe(second)
    expect(first).toContain('@ldd/dsh-video-frame-analyzer')
    expect(first).toContain('@ldd/dsh-generate')
    // KIE image generation is async (34s–90s+); the tool timeout must match the
    // provider's 600s polling ceiling, not the 60s that used to abort it early.
    expect(first).toContain('timeoutMs: 600000')
    expect(first).toMatch(/createRequire\(baseUrl\).*package\.json/)
    expect(first).toContain('maxImageBytes: 20971520')
    // Generated 4K images must survive normalization so the user can download
    // the original: long edge up to 4096px, encoded bytes up to 20MiB.
    expect(first).toContain('normalizedImageMaxDimension: 4096')
    expect(first).toContain('normalizedImageMaxBytes: 20971520')
    expect(first).not.toMatch(/(api[_-]?key|password|authorization|access[_-]?token|secret)\s*[:=]/i)
  })

  it('writes only the LDD-managed patch and atomically persists settings', async () => {
    await using fixture = await createFixtureDirectory('ldd-image-mode-')
    const dshHome = fixture.path('harness')
    const userPatch = fixture.path('harness', 'cordis.patch.yml')
    const settingsPath = fixture.path('settings.json')
    await mkdir(dshHome, { recursive: true })
    await writeFile(userPatch, '- id: user-owned\n')

    const managedPath = await writeManagedImagePatch(dshHome, 'large')
    await writeLddSettings(settingsPath, { schemaVersion: 1, imageMode: 'large' })

    expect(managedPath).toBe(fixture.path('harness', 'ldd-managed', 'cordis.patch.yml'))
    expect(await readFile(userPatch, 'utf8')).toBe('- id: user-owned\n')
    expect((await readLddSettings(settingsPath)).imageMode).toBe('large')
    expect(await readLddSettings(fixture.path('missing.json'))).toEqual(
      createDefaultLddSettings(),
    )
  })
})

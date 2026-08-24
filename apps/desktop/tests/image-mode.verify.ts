import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import {
  renderManagedImagePatch,
  resolveImageConfig,
} from '../src/main/profile/image-mode.ts'
import { writeManagedImagePatch } from '../src/main/profile/write-managed-patch.ts'
import {
  createDefaultLddSettings,
  readLddSettings,
  writeLddSettings,
} from '../src/main/settings.ts'

test('standard and large image modes retain every upstream safety bound', async () => {
  const standard = resolveImageConfig('standard')
  const large = resolveImageConfig('large')
  assert.equal(standard.maxImageBytes, 20 * 1024 * 1024)
  assert.equal(large.maxImageBytes, 64 * 1024 * 1024)
  assert.equal(standard.imageCompressionConcurrency, 2)
  assert.equal(large.imageCompressionConcurrency, 1)
  assert.deepEqual(
    { ...large, maxImageBytes: standard.maxImageBytes, imageCompressionConcurrency: 2 },
    standard,
  )
  assert.equal(renderManagedImagePatch('standard'), renderManagedImagePatch('standard'))
  assert.match(renderManagedImagePatch('large'), /maxImageBytes: 67108864/)
  assert.match(renderManagedImagePatch('standard'), /@ldd\/dsh-video-frame-analyzer/)
  assert.match(renderManagedImagePatch('standard'), /@ldd\/dsh-generate/)
  assert.match(renderManagedImagePatch('standard'), /createRequire\(baseUrl\).*package\.json/)
})

test('managed patch and settings never overwrite the user patch', async () => {
  await using fixture = await createFixtureDirectory('ldd-image-mode-verify-')
  const dshHome = fixture.path('harness')
  const userPatch = fixture.path('harness', 'cordis.patch.yml')
  const settingsPath = fixture.path('settings.json')
  await mkdir(dshHome, { recursive: true })
  await writeFile(userPatch, '- id: user-owned\n')

  const managedPath = await writeManagedImagePatch(dshHome, 'large')
  await writeLddSettings(settingsPath, { schemaVersion: 1, imageMode: 'large' })

  assert.equal(managedPath, fixture.path('harness', 'ldd-managed', 'cordis.patch.yml'))
  assert.equal(await readFile(userPatch, 'utf8'), '- id: user-owned\n')
  assert.match(await readFile(managedPath, 'utf8'), /maxImageBytes: 67108864/)
  assert.deepEqual(await readLddSettings(settingsPath), {
    schemaVersion: 1,
    imageMode: 'large',
  })
  assert.deepEqual(await readLddSettings(fixture.path('missing.json')), createDefaultLddSettings())

  await writeFile(settingsPath, '{"schemaVersion":1,"imageMode":"unlimited"}')
  await assert.rejects(() => readLddSettings(settingsPath), /imageMode/)
})

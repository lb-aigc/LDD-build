import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import test from 'node:test'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import { sha256File, verifyFileChecksum } from '../../../packages/runtime-kit/src/checksum.ts'
import { validateRuntimeArchivePath } from '../src/main/runtime/archive.ts'
import { parseRuntimeManifest } from '../src/main/runtime/manifest.ts'

const manifest = {
  formatVersion: 1,
  harnessVersion: '0.1.1-rc.2',
  platform: 'win32',
  arch: 'x64',
  nodeMajor: 24,
  createdAt: '2026-08-22T10:00:00.000Z',
  minimumLddVersion: '0.2.0',
  sourceArchiveSha256:
    '47fb7e386c0bd86a6c4341321b8f2915cd6f490a687f8deaf78714e369e4c91d',
  npmIntegrity: null,
  plugins: [],
  files: [{ path: 'package.json', size: 3, sha256: '2'.repeat(64) }],
}

test('checksum, manifest, and Windows path safety', async () => {
  await using fixture = await createFixtureDirectory('ldd-runtime-security-')
  const target = fixture.path('payload.bin')
  await writeFile(target, 'abc')
  assert.equal(
    await sha256File(target),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  await assert.rejects(() => verifyFileChecksum(target, '0'.repeat(64)), /checksum mismatch/)

  assert.deepEqual(parseRuntimeManifest(manifest), manifest)
  assert.throws(
    () => parseRuntimeManifest({ ...manifest, nodeMajor: 22 }),
    /nodeMajor/,
  )
  assert.throws(
    () =>
      parseRuntimeManifest({
        ...manifest,
        files: [...manifest.files, { ...manifest.files[0], path: 'PACKAGE.json' }],
      }),
    /duplicate runtime path/,
  )

  for (const path of [
    '../escape.txt',
    '/absolute.txt',
    'C:/windows/system32/file',
    'safe/../../escape.txt',
    'safe\\escape.txt',
    'plugins/NUL.txt',
    'package.json ',
    'plugins/bad<name>.tgz',
    'plugins/NUL .txt',
  ]) {
    assert.throws(() => validateRuntimeArchivePath(path), /unsafe runtime path/)
  }
  assert.equal(
    validateRuntimeArchivePath('node_modules/pkg/index.js'),
    'node_modules/pkg/index.js',
  )
})

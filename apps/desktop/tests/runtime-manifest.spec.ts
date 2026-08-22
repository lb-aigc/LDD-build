import { describe, expect, it } from 'vitest'
import { parseRuntimeManifest } from '../src/main/runtime/manifest.js'

const validManifest = {
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
  plugins: [
    {
      name: '@ldd/dsh-video-frame-analyzer',
      version: '0.2.0',
      sha256: '1'.repeat(64),
    },
  ],
  files: [{ path: 'package.json', size: 3, sha256: '2'.repeat(64) }],
}

describe('runtime manifest', () => {
  it('accepts the exact Windows x64 Node 24 format', () => {
    expect(parseRuntimeManifest(validManifest)).toEqual(validManifest)
  })

  it('rejects an incompatible Node ABI', () => {
    expect(() => parseRuntimeManifest({ ...validManifest, nodeMajor: 22 })).toThrow(
      'nodeMajor',
    )
  })

  it('rejects duplicate file identities under Windows case folding', () => {
    expect(() =>
      parseRuntimeManifest({
        ...validManifest,
        files: [
          ...validManifest.files,
          { path: 'PACKAGE.json', size: 3, sha256: '2'.repeat(64) },
        ],
      }),
    ).toThrow('duplicate runtime path')
  })
})

export { validManifest }

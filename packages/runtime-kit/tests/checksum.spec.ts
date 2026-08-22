import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sha256File, verifyFileChecksum } from '../src/checksum.js'
import { createFixtureDirectory } from './fixture-directory.js'

describe('streaming checksum', () => {
  it('hashes a file and rejects mismatches', async () => {
    await using fixture = await createFixtureDirectory('ldd-checksum-')
    const target = fixture.path('payload.bin')
    await writeFile(target, 'abc')

    expect(await sha256File(target)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    await expect(verifyFileChecksum(target, '0'.repeat(64))).rejects.toThrow(
      'checksum mismatch',
    )
  })
})

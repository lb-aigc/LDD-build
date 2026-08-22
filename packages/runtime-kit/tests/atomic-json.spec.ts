import { readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createFixtureDirectory } from './fixture-directory.js'
import { writeAtomicJson } from '../src/atomic-json.js'

describe('writeAtomicJson', () => {
  it('persists complete JSON with private file permissions', async () => {
    await using fixture = await createFixtureDirectory('ldd-atomic-json-')
    const target = fixture.path('nested', 'state.json')

    await writeAtomicJson(target, { activeVersion: '0.1.1-rc.2' })

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({
      activeVersion: '0.1.1-rc.2',
    })
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o600)
    }
  })
})

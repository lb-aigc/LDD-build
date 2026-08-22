import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.js'
import {
  createDefaultRuntimeState,
  readRuntimeState,
  writeRuntimeState,
} from '../src/main/runtime/state.js'

describe('runtime state', () => {
  it('returns defaults and a diagnostic without overwriting corrupt state', async () => {
    await using fixture = await createFixtureDirectory('ldd-runtime-state-')
    const target = fixture.path('state.json')
    await writeFile(target, '{not-json', 'utf8')

    const result = await readRuntimeState(target)

    expect(result.state).toEqual(createDefaultRuntimeState())
    expect(result.diagnostics).toHaveLength(1)
    expect(await readFile(target, 'utf8')).toBe('{not-json')
  })

  it('round-trips a strictly valid state', async () => {
    await using fixture = await createFixtureDirectory('ldd-runtime-state-')
    const target = fixture.path('runtime', 'state.json')
    const state = {
      ...createDefaultRuntimeState(),
      activeVersion: '0.1.1-rc.2',
      lastCheckAt: '2026-08-22T10:00:00.000Z',
    }

    await writeRuntimeState(target, state)

    expect(await readRuntimeState(target)).toEqual({ state, diagnostics: [] })
  })
})

import { describe, expect, it } from 'vitest'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.js'
import { createDefaultRuntimeState, writeRuntimeState } from '../src/main/runtime/state.js'
import { RuntimeUpdater } from '../src/main/runtime/updater.js'

describe('RuntimeUpdater checks', () => {
  it('runs at most one automatic check per 24 hours', async () => {
    await using fixture = await createFixtureDirectory('ldd-updater-')
    const statePath = fixture.path('state.json')
    await writeRuntimeState(statePath, createDefaultRuntimeState())
    let calls = 0
    const updater = new RuntimeUpdater({
      statePath,
      now: () => new Date('2026-08-22T10:00:00.000Z'),
      registry: {
        resolve: async () => {
          calls += 1
          return null
        },
      },
    })

    expect((await updater.checkForUpdates('0.1.1-rc.2', false)).kind).toBe('up-to-date')
    expect((await updater.checkForUpdates('0.1.1-rc.2', false)).kind).toBe('skipped')
    expect(calls).toBe(1)
  })
})

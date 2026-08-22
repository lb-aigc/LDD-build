import { describe, expect, it, vi } from 'vitest'

import { completeExit, createWindowCloseHandler } from '../src/main/lifecycle.ts'

describe('desktop lifecycle', () => {
  it('awaits updater and Harness quiescence before quitting', async () => {
    const events: string[] = []
    await completeExit({
      disposeUpdater: async () => { events.push('updater-disposed') },
      stopHarness: async () => { events.push('harness-stopped') },
      quit: () => { events.push('quit') },
    })
    expect(events).toEqual(['updater-disposed', 'harness-stopped', 'quit'])
  })

  it('hides a normal close to tray', () => {
    const hide = vi.fn()
    const preventDefault = vi.fn()
    createWindowCloseHandler({ exiting: false }, hide)({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(hide).toHaveBeenCalledOnce()
  })
})

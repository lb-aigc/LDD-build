import { describe, expect, it } from 'vitest'
import { terminateProcessTree } from '../src/process-tree.js'

describe('terminateProcessTree', () => {
  it('escalates only after the graceful deadline and awaits quiescence', async () => {
    const signals: string[] = []
    let running = true
    await terminateProcessTree({
      pid: 123,
      isRunning: () => running,
      signalTree: async (force) => {
        signals.push(force ? 'force' : 'graceful')
        if (force) running = false
      },
      waitForExit: async () => !running,
      graceMs: 1,
      forceMs: 1,
    })

    expect(signals).toEqual(['graceful', 'force'])
  })
})

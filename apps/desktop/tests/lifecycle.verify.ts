import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completeExit,
  createCompleteExit,
  createWindowCloseHandler,
} from '../src/main/lifecycle.ts'

test('complete exit awaits updater disposal and Harness quiescence before quit', async () => {
  const events: string[] = []
  await completeExit({
    disposeUpdater: async () => { events.push('updater-disposed') },
    stopHarness: async () => { events.push('harness-stopped') },
    quit: () => { events.push('quit') },
  })
  assert.deepEqual(events, ['updater-disposed', 'harness-stopped', 'quit'])
})

test('window close hides to tray unless complete exit has begun', () => {
  const events: string[] = []
  const state = { exiting: false }
  const onClose = createWindowCloseHandler(state, () => events.push('hide'))
  const close = { preventDefault: () => events.push('prevent') }
  onClose(close)
  assert.deepEqual(events, ['prevent', 'hide'])

  state.exiting = true
  onClose(close)
  assert.deepEqual(events, ['prevent', 'hide'])
})

test('complete exit is single-flight and never quits after failed quiescence', async () => {
  let quitCalls = 0
  const failure = new Error('Harness still running')
  const state = { exiting: false }
  const exit = createCompleteExit(state, {
    disposeUpdater: async () => undefined,
    stopHarness: async () => { throw failure },
    quit: () => { quitCalls += 1 },
  })
  const first = exit()
  const second = exit()
  assert.equal(first, second)
  await assert.rejects(first, failure)
  assert.equal(state.exiting, false)
  assert.equal(quitCalls, 0)
})

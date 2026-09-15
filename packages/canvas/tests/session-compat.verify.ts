import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerCanvasSessionEvent } from '../src/session-compat.ts'

test('registers the required durable canvas event exactly once', () => {
  const values = new Set(['user/message'])
  registerCanvasSessionEvent(values)
  registerCanvasSessionEvent(values)
  assert.deepEqual([...values], ['user/message', 'canvas/state'])
})

test('refuses a closed vocabulary that cannot be extended', () => {
  const values = { has: () => false } as unknown as ReadonlySet<string>
  assert.throws(
    () => registerCanvasSessionEvent(values),
    /cannot register LDD canvas persistence/u,
  )
})

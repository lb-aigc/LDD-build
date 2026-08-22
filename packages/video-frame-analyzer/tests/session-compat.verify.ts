import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerVideoAnalysisSessionEvent } from '../src/session-compat.ts'

test('registers the required durable video event exactly once', () => {
  const values = new Set(['user/message'])
  registerVideoAnalysisSessionEvent(values)
  registerVideoAnalysisSessionEvent(values)
  assert.deepEqual([...values], ['user/message', 'video/analysis-input'])
})

test('refuses a closed vocabulary that cannot be extended', () => {
  const values = { has: () => false } as unknown as ReadonlySet<string>
  assert.throws(
    () => registerVideoAnalysisSessionEvent(values),
    /cannot register LDD video persistence/u,
  )
})

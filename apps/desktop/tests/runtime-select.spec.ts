import { describe, expect, it } from 'vitest'
import { createDefaultRuntimeState } from '../src/main/runtime/state.js'
import { selectRuntime } from '../src/main/runtime/select.js'

describe('selectRuntime', () => {
  it('selects active, then last-known-good, then fallback', () => {
    const state = {
      ...createDefaultRuntimeState(),
      activeVersion: '0.1.1-rc.2',
      lastKnownGoodVersion: '0.1.1-rc.1',
    }
    const inventory = {
      external: new Map([
        ['0.1.1-rc.2', { path: 'v2', valid: false }],
        ['0.1.1-rc.1', { path: 'v1', valid: true }],
      ]),
      fallback: { path: 'fallback', version: '0.1.1-rc.2', valid: true },
    }

    expect(selectRuntime(state, inventory)).toMatchObject({
      kind: 'external',
      version: '0.1.1-rc.1',
      path: 'v1',
    })
  })

  it('reports a failure only when every candidate is unavailable or invalid', () => {
    const selection = selectRuntime(createDefaultRuntimeState(), {
      external: new Map(),
      fallback: {
        path: 'fallback',
        version: '0.1.1-rc.2',
        valid: false,
        reason: 'checksum mismatch',
      },
    })

    expect(selection.kind).toBe('failure')
    expect(selection.reasons).toContain('fallback 0.1.1-rc.2: checksum mismatch')
  })
})

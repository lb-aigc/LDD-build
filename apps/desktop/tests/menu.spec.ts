import { describe, expect, it, vi } from 'vitest'

import { createHelpMenu } from '../src/main/menu.ts'

describe('Help menu', () => {
  it('contains the complete Harness recovery surface', () => {
    const action = vi.fn()
    const items = createHelpMenu({
      openUpdate: action,
      showCurrentRuntime: action,
      rollback: action,
      openPluginCenter: action,
      openLogs: action,
    })
    expect(items.map((item) => item.id)).toEqual([
      'harness-update',
      'current-runtime',
      'rollback-runtime',
      'plugin-center',
      'open-logs',
    ])
  })
})

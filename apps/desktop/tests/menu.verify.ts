import assert from 'node:assert/strict'
import test from 'node:test'

import { createHelpMenu } from '../src/main/menu.ts'

test('Help menu exposes every fixed runtime recovery destination', () => {
  const invoked: string[] = []
  const items = createHelpMenu({
    openUpdate: () => { invoked.push('update') },
    showCurrentRuntime: () => { invoked.push('current') },
    rollback: () => { invoked.push('rollback') },
    openPluginCenter: () => { invoked.push('plugins') },
    openLogs: () => { invoked.push('logs') },
  })
  assert.deepEqual(items.map((item) => item.id), [
    'harness-update',
    'current-runtime',
    'rollback-runtime',
    'plugin-center',
    'open-logs',
  ])
  for (const item of items) item.activate()
  assert.deepEqual(invoked, ['update', 'current', 'rollback', 'plugins', 'logs'])
})

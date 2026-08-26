import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

import { createEditMenu, createFileMenu, createHelpMenu } from '../src/main/menu.ts'

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

describe('File menu', () => {
  it('wires new-window and exit to the shell actions', () => {
    const newWindow = vi.fn()
    const exit = vi.fn()
    const menu = createFileMenu({ newWindow, exit })
    expect(menu.label).toBe('文件')
    const submenu = menu.submenu as MenuItemConstructorOptions[]
    const clickable = submenu.filter((item) => item.type !== 'separator')
    expect(clickable.map((item) => item.label)).toEqual(['新建窗口', '退出'])
    // click handlers route to the right action
    ;(clickable[0]?.click as () => void)()
    ;(clickable[1]?.click as () => void)()
    expect(newWindow).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
  })
})

describe('Edit menu', () => {
  it('uses native roles for the standard editing actions', () => {
    const menu = createEditMenu()
    expect(menu.label).toBe('编辑')
    const submenu = menu.submenu as MenuItemConstructorOptions[]
    expect(submenu.map((item) => item.role)).toEqual([
      'undo',
      'redo',
      undefined,
      'cut',
      'copy',
      'paste',
      'delete',
      undefined,
      'selectAll',
    ])
  })
})

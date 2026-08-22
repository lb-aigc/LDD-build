import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PluginRiskDialog } from './PluginRiskDialog.tsx'

describe('PluginRiskDialog', () => {
  it('states the current-user file, credential, and network risks', () => {
    render(<PluginRiskDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '打开第三方插件中心' })
    expect(dialog.textContent).toContain('当前 Windows 用户权限')
    expect(dialog.textContent).toContain('文件')
    expect(dialog.textContent).toContain('凭据')
    expect(dialog.textContent).toContain('网络')
  })
})

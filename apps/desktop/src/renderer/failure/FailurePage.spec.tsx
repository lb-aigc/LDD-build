import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LddRendererApi } from '../../main/ipc/contracts.ts'
import { FailurePage } from './FailurePage.tsx'

describe('FailurePage', () => {
  it('calls only fixed no-argument recovery actions', async () => {
    const retryBoot = vi.fn().mockResolvedValue(undefined)
    const openLogDirectory = vi.fn().mockResolvedValue(undefined)
    const api = {
      retryBoot,
      openLogDirectory,
      rollback: vi.fn().mockResolvedValue(undefined),
      importOfflineRuntime: vi.fn().mockResolvedValue(undefined),
    } as unknown as LddRendererApi
    const user = userEvent.setup()
    render(<FailurePage api={api} diagnostics={['身份探针未通过']} />)

    await user.click(screen.getByRole('button', { name: /^重试启动/ }))
    await user.click(screen.getByRole('button', { name: /^打开日志目录/ }))
    expect(retryBoot).toHaveBeenCalledWith()
    expect(openLogDirectory).toHaveBeenCalledWith()
    expect(screen.getByText('身份探针未通过')).toBeTruthy()
  })
})

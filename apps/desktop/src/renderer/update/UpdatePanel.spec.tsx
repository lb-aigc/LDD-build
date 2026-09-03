import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LddRendererApi } from '../../main/ipc/contracts.ts'
import { UpdatePanel } from './UpdatePanel.tsx'

function apiFixture(): LddRendererApi {
  return {
    getStatus: vi.fn().mockResolvedValue({
      desktopVersion: '0.2.0',
      activeVersion: '0.1.1-rc.1',
      lastKnownGoodVersion: '0.1.1-rc.1',
      availableVersion: '0.1.1-rc.2',
      channel: 'prerelease',
      imageMode: 'standard',
      diagnostics: [],
    }),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    activateVersion: vi.fn().mockResolvedValue(undefined),
    importOfflineRuntime: vi.fn(),
    rollback: vi.fn(),
    setImageMode: vi.fn(),
    getDataDirectory: vi.fn().mockResolvedValue({ dataDirectory: null }),
    setDataDirectory: vi.fn().mockResolvedValue({ dataDirectory: 'D:\\LDD', cancelled: false }),
    openPluginCenter: vi.fn(),
    retryBoot: vi.fn(),
    openLogDirectory: vi.fn(),
    saveImage: vi.fn().mockResolvedValue({ saved: false }),
    saveAudio: vi.fn().mockResolvedValue({ saved: false }),
    importFile: vi.fn().mockResolvedValue({ imported: false, relativePath: '', kind: 'other' }),
    subscribeProgress: vi.fn().mockReturnValue(() => undefined),
  }
}

describe('UpdatePanel', () => {
  it('does not activate a downloaded runtime until the user confirms', async () => {
    const api = apiFixture()
    const user = userEvent.setup()
    render(<UpdatePanel api={api} />)

    await user.click(await screen.findByRole('button', { name: '下载新内核' }))
    expect(api.activateVersion).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '切换到新内核' }))
    expect(api.activateVersion).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认并重启' }))
    expect(api.activateVersion).toHaveBeenCalledWith('0.1.1-rc.2')
  })
})

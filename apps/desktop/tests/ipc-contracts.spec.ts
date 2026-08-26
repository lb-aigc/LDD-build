import { describe, expect, it } from 'vitest'
import {
  parseIpcRequest,
  rendererApiKeys,
} from '../src/main/ipc/contracts.js'

describe('renderer IPC contract', () => {
  it('exposes only the narrow allowlist', () => {
    expect(rendererApiKeys).toEqual([
      'getStatus',
      'checkForUpdates',
      'downloadUpdate',
      'activateVersion',
      'importOfflineRuntime',
      'rollback',
      'setImageMode',
      'openPluginCenter',
      'retryBoot',
      'openLogDirectory',
      'saveImage',
      'importFile',
      'subscribeProgress',
    ])
  })

  it('never accepts a command or destination path parameter', () => {
    expect(() =>
      parseIpcRequest('activateVersion', {
        version: '0.1.1-rc.2',
        command: 'powershell',
        destination: 'C:\\Windows',
      }),
    ).toThrow('unexpected')
    expect(() => parseIpcRequest('importOfflineRuntime', { path: 'C:\\x' })).toThrow(
      'no input',
    )
    expect(() => parseIpcRequest('openLogDirectory', { path: 'C:\\x' })).toThrow('no input')
  })
})

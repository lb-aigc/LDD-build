import assert from 'node:assert/strict'
import test from 'node:test'
import { parseIpcRequest, rendererApiKeys } from '../src/main/ipc/contracts.ts'
import {
  isAllowedHarnessNavigation,
  isAllowedRendererNavigation,
  isApprovedExternalUrl,
  makeWindowOptions,
} from '../src/main/window.ts'

test('renderer API is narrow and rejects command/path injection', () => {
  assert.deepEqual(rendererApiKeys, [
    'getStatus',
    'checkForUpdates',
    'downloadUpdate',
    'activateVersion',
    'importOfflineRuntime',
    'rollback',
    'setImageMode',
    'getDataDirectory',
    'setDataDirectory',
    'openPluginCenter',
    'retryBoot',
    'openLogDirectory',
    'saveImage',
    'importFile',
    'subscribeProgress',
  ])
  assert.throws(
    () =>
      parseIpcRequest('activateVersion', {
        version: '0.1.1-rc.2',
        command: 'powershell',
        destination: 'C:\\Windows',
      }),
    /unexpected/,
  )
  assert.throws(() => parseIpcRequest('importOfflineRuntime', { path: 'C:\\x' }), /no input/)
  assert.throws(() => parseIpcRequest('openLogDirectory', { path: 'C:\\x' }), /no input/)
})

test('window flags and navigation policy remain fail-closed', () => {
  const options = makeWindowOptions('C:\\LDD\\preload.js')
  assert.deepEqual(options.webPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    preload: 'C:\\LDD\\preload.js',
    sandbox: true,
    webSecurity: true,
  })
  assert.equal(
    isAllowedHarnessNavigation(
      'http://127.0.0.1:3080/session/1',
      'http://127.0.0.1:3080',
    ),
    true,
  )
  assert.equal(
    isAllowedHarnessNavigation('http://127.0.0.1:3081', 'http://127.0.0.1:3080'),
    false,
  )
  assert.equal(isApprovedExternalUrl('https://github.com/topics/dsh-plugin'), true)
  assert.equal(isApprovedExternalUrl('https://evil.test'), false)
  assert.equal(
    isAllowedRendererNavigation(
      'file:///C:/Program%20Files/LDD/resources/app.asar/dist/renderer/index.html?view=failure',
      'file:///C:/Program%20Files/LDD/resources/app.asar/dist/renderer/index.html',
    ),
    true,
  )
  assert.equal(
    isAllowedRendererNavigation(
      'file:///C:/Program%20Files/LDD/resources/app.asar/package.json',
      'file:///C:/Program%20Files/LDD/resources/app.asar/dist/renderer/index.html',
    ),
    false,
  )
})

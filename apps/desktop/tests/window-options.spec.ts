import { describe, expect, it } from 'vitest'
import {
  isAllowedHarnessNavigation,
  makeWindowOptions,
} from '../src/main/window.js'

describe('desktop window security', () => {
  it('fixes sandboxed renderer defaults', () => {
    expect(makeWindowOptions('C:\\LDD\\preload.js').webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    })
  })

  it('allows navigation only within the verified Harness origin', () => {
    expect(
      isAllowedHarnessNavigation(
        'http://127.0.0.1:3080/session/1',
        'http://127.0.0.1:3080',
      ),
    ).toBe(true)
    expect(
      isAllowedHarnessNavigation('http://127.0.0.1:3081', 'http://127.0.0.1:3080'),
    ).toBe(false)
    expect(isAllowedHarnessNavigation('https://evil.test', 'http://127.0.0.1:3080')).toBe(
      false,
    )
  })
})

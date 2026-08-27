import { release } from 'node:os'

import type { BrowserWindowConstructorOptions } from 'electron'

/** Windows 11 build numbers start at 22000 (21H2). Windows 10 is below that.
 * Used to decide whether the real acrylic material is available. */
export const isWindows11: boolean = (() => {
  if (process.platform !== 'win32') return false
  const match = /^10\.0\.(\d+)/.exec(release())
  return match !== null && Number(match[1]) >= 22_000
})()

export function makeWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Win11: transparent window background so the acrylic material shows
    // through the HTML's transparent body (the real "blurred desktop behind
    // the window" effect). Win10: acrylic is silently ignored, so keep a solid
    // neutral background (the fallback CSS paints its own gradient).
    backgroundColor: isWindows11 ? '#00000000' : '#e8e8ec',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
  }
}

export function isAllowedHarnessNavigation(target: string, harnessOrigin: string): boolean {
  try {
    const expected = new URL(harnessOrigin)
    const destination = new URL(target)
    return (
      expected.protocol === 'http:' &&
      expected.hostname === '127.0.0.1' &&
      expected.username.length === 0 &&
      expected.password.length === 0 &&
      destination.origin === expected.origin &&
      destination.username.length === 0 &&
      destination.password.length === 0
    )
  } catch {
    return false
  }
}

export function isApprovedExternalUrl(target: string): boolean {
  try {
    const url = new URL(target)
    if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) {
      return false
    }
    return (
      url.hostname === 'github.com' ||
      url.hostname === 'api-docs.deepseek.com' ||
      url.hostname === 'www.deepseek.com'
    )
  } catch {
    return false
  }
}

export function isAllowedRendererNavigation(target: string, rendererFileUrl: string): boolean {
  try {
    const expected = new URL(rendererFileUrl)
    const destination = new URL(target)
    return expected.protocol === 'file:' && destination.protocol === 'file:' &&
      expected.host === '' && destination.host === '' &&
      destination.pathname === expected.pathname &&
      destination.username.length === 0 && destination.password.length === 0
  } catch {
    return false
  }
}

export interface GuardedWebContents {
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, target: string) => void,
  ): void
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'allow' | 'deny' },
  ): void
}

export function installNavigationGuards(
  webContents: GuardedWebContents,
  harnessOrigin: string | (() => string | null),
  openExternal: (url: string) => Promise<void>,
  rendererFileUrl?: string,
): void {
  webContents.on('will-navigate', (event, target) => {
    const currentOrigin = resolveHarnessOrigin(harnessOrigin)
    const allowedHarness = currentOrigin !== null && isAllowedHarnessNavigation(target, currentOrigin)
    const allowedRenderer = rendererFileUrl !== undefined &&
      isAllowedRendererNavigation(target, rendererFileUrl)
    if (!allowedHarness && !allowedRenderer) {
      event.preventDefault()
      if (isApprovedExternalUrl(target)) void openExternal(target)
    }
  })
  webContents.setWindowOpenHandler(({ url }) => {
    if (isApprovedExternalUrl(url)) void openExternal(url)
    return { action: 'deny' }
  })
}

function resolveHarnessOrigin(provider: string | (() => string | null)): string | null {
  return typeof provider === 'string' ? provider : provider()
}

import { resolve } from 'node:path'
import type {
  HarnessRuntime,
  HarnessStartOptions,
} from '../../src/main/harness/types.js'

const fakeServer = resolve(import.meta.dirname, '../fixtures/fake-harness-server.mjs')

export function fakeHarnessRuntime(): HarnessRuntime {
  return {
    version: '0.1.1-rc.2',
    rootPath: resolve(import.meta.dirname, '../../../../..'),
    nodePath: process.execPath,
    dshEntryPath: fakeServer,
    pnpmPath: process.execPath,
    ffmpegPath: process.execPath,
    ffprobePath: process.execPath,
  }
}

export function harnessOptions(
  overrides: Partial<HarnessStartOptions> = {},
): HarnessStartOptions {
  return {
    dshHome: resolve(import.meta.dirname, '../../../../.test-dsh-home'),
    imageMode: 'standard',
    managedPatchPath: resolve(import.meta.dirname, '../../../../managed.patch.yml'),
    preferredPort: 3080,
    startupTimeoutMs: 5_000,
    stopGraceMs: 1_000,
    forceStopMs: 1_000,
    environment: {},
    onDiagnostic: () => undefined,
    ...overrides,
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'

import * as runtimeBuilder from '../src/build-runtime.ts'

test('Windows batch commands are launched through ComSpec without enabling spawn shell mode', () => {
  const candidate = (runtimeBuilder as Record<string, unknown>).resolveSpawnInvocation
  assert.equal(typeof candidate, 'function')
  const resolveSpawnInvocation = candidate as (
    command: string,
    args: readonly string[],
    platform: NodeJS.Platform,
    environment: Readonly<NodeJS.ProcessEnv>,
  ) => { readonly command: string; readonly args: readonly string[] }

  assert.deepEqual(
    resolveSpawnInvocation('pnpm.cmd', ['--version'], 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', '--version'],
    },
  )
})

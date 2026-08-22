import assert from 'node:assert/strict'
import test from 'node:test'

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

import { runManagedSubprocess, type SubprocessSpawner } from '../src/subprocess-runner.ts'

test('runs media commands through the Harness managed subprocess seam', async () => {
  let captured: SubprocessSpawnSpec | undefined
  let terminated = 0
  let waited = 0
  let tracked = 0
  const handle: SubprocessHandle = {
    pid: 42,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: 'scene-data', nextOffset: 10, lossy: false }) },
      stderr: { readFrom: () => ({ text: 'recoverable decode warning', nextOffset: 26, lossy: false }) },
    },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => { terminated += 1 },
    waitForExit: async () => { waited += 1; return true },
  }
  const spawner: SubprocessSpawner = {
    spawn(spec) {
      captured = spec
      return handle
    },
  }
  const signal = new AbortController().signal
  const result = await runManagedSubprocess(
    spawner,
    'C:\\LDD\\ffmpeg.exe',
    ['-version'],
    'C:\\temp',
    signal,
    {
      maxOutputBytes: 1024,
      graceMs: 3000,
      trackChild: () => { tracked += 1 },
    },
  )
  assert.equal(result.stdout, 'scene-data')
  assert.equal(result.stderr, 'recoverable decode warning')
  assert.equal(terminated, 1)
  assert.equal(waited, 1)
  assert.equal(tracked, 1)
  assert.deepEqual(captured?.argv, ['C:\\LDD\\ffmpeg.exe', '-version'])
  assert.equal(captured?.signal, signal)
  assert.deepEqual(captured?.stdio, {
    stdin: 'ignore',
    stdout: { maxBytes: 1024 },
    stderr: { maxBytes: 1024 },
  })
})

test('rejects lossy collected output', async () => {
  const spawner: SubprocessSpawner = {
    spawn: () => ({
      pid: 43,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => ({ text: 'tail', nextOffset: 9_999, lossy: true }) },
        stderr: { readFrom: () => ({ text: 'decode failed', nextOffset: 13, lossy: false }) },
      },
      done: Promise.resolve({ exitCode: 1, signal: null }),
      terminate: () => undefined,
      waitForExit: async () => true,
    }),
  }
  await assert.rejects(
    runManagedSubprocess(
      spawner,
      'C:\\LDD\\ffmpeg.exe',
      [],
      'C:\\temp',
      new AbortController().signal,
      { maxOutputBytes: 1024, graceMs: 3000 },
    ),
    /safety limit/,
  )
})

test('reports bounded diagnostics from nonzero media processes', async () => {
  const spawner: SubprocessSpawner = {
    spawn: () => ({
      pid: 44,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: 'decode failed', nextOffset: 13, lossy: false }) },
      },
      done: Promise.resolve({ exitCode: 1, signal: null }),
      terminate: () => undefined,
      waitForExit: async () => true,
    }),
  }
  await assert.rejects(
    runManagedSubprocess(
      spawner,
      'C:\\LDD\\ffmpeg.exe',
      [],
      'C:\\temp',
      new AbortController().signal,
      { maxOutputBytes: 1024, graceMs: 3000 },
    ),
    /decode failed/,
  )
})

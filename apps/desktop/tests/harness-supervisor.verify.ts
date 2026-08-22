import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import test from 'node:test'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import { createHarnessArgs, HarnessSupervisor } from '../src/main/harness/supervisor.ts'
import { fakeHarnessRuntime, harnessOptions } from './support/fake-harness.ts'

test('places launcher patch flags before pass-through web flags', () => {
  assert.deepEqual(createHarnessArgs('dsh.js', 'managed.patch.yml', 3080), [
    'dsh.js',
    'web',
    '--patch',
    'managed.patch.yml',
    '--host',
    '127.0.0.1',
    '--port',
    '3080',
    '--no-open',
  ])
})

test('supervisor avoids occupied ports, verifies identity, redacts, and stops', async () => {
  const unrelated = createServer()
  await new Promise<void>((resolve) => unrelated.listen(0, '127.0.0.1', resolve))
  const address = unrelated.address()
  if (address === null || typeof address === 'string') throw new Error('missing test port')
  const diagnostics: string[] = []
  const supervisor = new HarnessSupervisor()
  try {
    const handle = await supervisor.start(
      fakeHarnessRuntime(),
      harnessOptions({
        preferredPort: address.port,
        onDiagnostic: (line) => diagnostics.push(line),
        environment: { LDD_TEST_LOG_SECRET: 'sk-super-secret-123456' },
      }),
    )
    assert.notEqual(handle.port, address.port)
    assert.equal(handle.url, `http://127.0.0.1:${handle.port}`)
    assert.equal(handle.pid > 0, true)
    await handle.stop()
    assert.equal(supervisor.current, null)
    assert.equal(diagnostics.some((line) => line.includes('sk-super-secret-123456')), false)
    assert.equal(diagnostics.some((line) => line.includes('[REDACTED]')), true)
  } finally {
    await supervisor.stop()
    await new Promise<void>((resolve, reject) =>
      unrelated.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  }
})

test('supervisor force-stops a non-cooperative process tree without an orphan', async () => {
  await using fixture = await createFixtureDirectory('ldd-supervisor-tree-')
  const childPidFile = fixture.path('child.pid')
  const supervisor = new HarnessSupervisor()
  const handle = await supervisor.start(
    fakeHarnessRuntime(),
    harnessOptions({
      stopGraceMs: 25,
      forceStopMs: 1_000,
      environment: {
        LDD_TEST_CHILD_PID_FILE: childPidFile,
        LDD_TEST_IGNORE_TERM: '1',
      },
    }),
  )
  const childPid = Number(await readFile(childPidFile, 'utf8'))

  await handle.stop()

  assert.equal(await waitForProcessGone(handle.pid), true)
  assert.equal(await waitForProcessGone(childPid), true)
  assert.equal(supervisor.current, null)
})

async function waitForProcessGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        return true
      }
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

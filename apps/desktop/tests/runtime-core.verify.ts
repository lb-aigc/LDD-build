import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import { writeAtomicJson } from '../../../packages/runtime-kit/src/atomic-json.ts'
import {
  createDefaultRuntimeState,
  readRuntimeState,
  writeRuntimeState,
} from '../src/main/runtime/state.ts'
import { selectRuntime } from '../src/main/runtime/select.ts'

test('atomic state persistence, corruption recovery, and runtime selection', async () => {
  await using fixture = await createFixtureDirectory('ldd-runtime-core-')
  const atomicTarget = fixture.path('atomic', 'state.json')
  await writeAtomicJson(atomicTarget, { ok: true })
  assert.deepEqual(JSON.parse(await readFile(atomicTarget, 'utf8')), { ok: true })

  const corruptTarget = fixture.path('corrupt.json')
  await writeFile(corruptTarget, '{bad', 'utf8')
  const corrupt = await readRuntimeState(corruptTarget)
  assert.deepEqual(corrupt.state, createDefaultRuntimeState())
  assert.equal(corrupt.diagnostics.length, 1)
  assert.equal(await readFile(corruptTarget, 'utf8'), '{bad')

  const validTarget = fixture.path('valid.json')
  const validState = {
    ...createDefaultRuntimeState(),
    activeVersion: '0.1.1-rc.2',
    lastKnownGoodVersion: '0.1.1-rc.1',
  }
  await writeRuntimeState(validTarget, validState)
  assert.deepEqual((await readRuntimeState(validTarget)).state, validState)

  const selection = selectRuntime(validState, {
    external: new Map([
      ['0.1.1-rc.2', { path: 'v2', valid: false }],
      ['0.1.1-rc.1', { path: 'v1', valid: true }],
    ]),
    fallback: { path: 'fallback', version: '0.1.1-rc.2', valid: true },
  })
  assert.deepEqual(selection, {
    kind: 'external',
    path: 'v1',
    reasons: ['active 0.1.1-rc.2: integrity check failed'],
    version: '0.1.1-rc.1',
  })
})

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  approvedHarnessSourceArchiveSha256,
  approvedHarnessSourceTreeSha256,
  assertApprovedHarnessSource,
  hashHarnessSourceTree,
} from '../src/source-identity.ts'

const officialSource = resolve(import.meta.dirname, '..', '..', '..', 'upstream', 'deepseek-harness')

test('pins both the approved archive bytes and its complete canonical source tree', async () => {
  assert.equal(await hashHarnessSourceTree(officialSource), approvedHarnessSourceTreeSha256)
  await assert.doesNotReject(assertApprovedHarnessSource(
    officialSource,
    approvedHarnessSourceArchiveSha256,
  ))
  await assert.rejects(
    assertApprovedHarnessSource(officialSource, 'a'.repeat(64)),
    /not the approved/,
  )
})

test('does not let a different tree borrow the approved archive identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ldd-source-identity-'))
  try {
    await writeFile(join(root, 'package.json'), '{}\n')
    await assert.rejects(
      assertApprovedHarnessSource(root, approvedHarnessSourceArchiveSha256),
      /does not match/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveLddPaths } from '../src/main/paths.ts'

test('separates mutable runtimes from the roaming Harness profile', () => {
  const paths = resolveLddPaths('/local', '/resources', '/roaming')
  assert.equal(paths.dataRoot, '/local/LDD')
  assert.equal(paths.versionsRoot, '/local/LDD/runtime/versions')
  assert.equal(paths.dshHome, '/roaming/LDD/harness')
  assert.equal(paths.fallbackRoot, '/resources/runtime-fallback')
})

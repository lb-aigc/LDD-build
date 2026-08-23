import assert from 'node:assert/strict'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

import { resolveLddPaths } from '../src/main/paths.ts'

test('separates mutable runtimes from the roaming Harness profile', () => {
  const localRoot = resolve('fixtures', 'local')
  const resourcesRoot = resolve('fixtures', 'resources')
  const roamingRoot = resolve('fixtures', 'roaming')
  const paths = resolveLddPaths(localRoot, resourcesRoot, roamingRoot)

  assert.equal(relative(localRoot, paths.dataRoot), 'LDD')
  assert.equal(relative(paths.dataRoot, paths.versionsRoot), join('runtime', 'versions'))
  assert.equal(relative(roamingRoot, paths.dshHome), join('LDD', 'harness'))
  assert.equal(relative(resourcesRoot, paths.fallbackRoot), 'runtime-fallback')
  assert.notEqual(paths.dataRoot, paths.dshHome)
})

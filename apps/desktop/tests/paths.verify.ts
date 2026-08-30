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

test('relocates the whole data tree to an override data directory', () => {
  const localRoot = resolve('fixtures', 'local')
  const resourcesRoot = resolve('fixtures', 'resources')
  const roamingRoot = resolve('fixtures', 'roaming')
  const override = resolve('fixtures', 'd-drive', 'LDD')
  const paths = resolveLddPaths(localRoot, resourcesRoot, roamingRoot, override)

  // dataRoot IS the chosen directory (settings.json lands at its root)…
  assert.equal(paths.dataRoot, override)
  // …while sessions/attachments land under <chosen>\harness.
  assert.equal(paths.dshHome, join(override, 'harness'))
  assert.equal(paths.settingsPath, join(override, 'settings.json'))
  // The bootstrap config itself stays at the FIXED roaming location, never the data root.
  assert.equal(paths.locationPath, join(resolve('fixtures', 'roaming'), 'LDD', 'location.json'))
  assert.equal(relative(resourcesRoot, paths.fallbackRoot), 'runtime-fallback')
})

test('rejects a relative override data directory', () => {
  const localRoot = resolve('fixtures', 'local')
  const resourcesRoot = resolve('fixtures', 'resources')
  const roamingRoot = resolve('fixtures', 'roaming')
  assert.throws(
    () => resolveLddPaths(localRoot, resourcesRoot, roamingRoot, 'relative/dir'),
    /absolute/,
  )
})

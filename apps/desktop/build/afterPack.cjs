'use strict'

// electron-builder hard-codes out the source root's `node_modules` while
// copying `extraResources` (see electron-builder util/filter.ts: "filter the
// root node_modules ... return false"). The Harness runtime fallback has its
// hoisted node_modules directly under its root, so it is dropped by that
// filter and the installed app cannot boot. This afterPack hook copies the
// already-built runtime fallback's node_modules back into the packaged
// resources so the installer ships a complete, bootable runtime.

const { cpSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

exports.default = async function afterPack(context) {
  const source = resolve(context.packager.projectDir, '../../dist/runtime/0.1.1-rc.2/node_modules')
  const destination = join(context.appOutDir, 'resources', 'runtime-fallback', 'node_modules')

  if (!existsSync(source)) {
    throw new Error(`LDD afterPack: runtime fallback node_modules is missing: ${source}`)
  }

  cpSync(source, destination, { recursive: true })
}

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
  const source = resolve(context.packager.projectDir, '../../dist/runtime/0.1.5-rc.1/node_modules')
  // electron-builder strips the extraResources node_modules during copy; this
  // hook restores it into the packaged app. The resources dir is platform-
  // specific: macOS puts it inside the .app bundle (appOutDir is the parent of
  // <productName>.app on darwin, so the bundle name is one more segment), while
  // Windows/Linux keep a sibling `resources` dir next to the unpacked app.
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const destination = join(resourcesDir, 'runtime-fallback', 'node_modules')

  if (!existsSync(source)) {
    throw new Error(`LDD afterPack: runtime fallback node_modules is missing: ${source}`)
  }

  cpSync(source, destination, { recursive: true })
}

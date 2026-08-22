import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')

test('one-click bundle packages the checksum-pinned runtime host', async () => {
  const source = await readFile(resolve(root, 'scripts/package-windows-build-bundle.mjs'), 'utf8')
  assert.match(source, /join\(repositoryRoot, 'vendor', 'runtime-host'\)/u)
  assert.match(source, /node\.exe/u)
  assert.match(source, /ffmpeg\.exe/u)
  assert.match(source, /ffprobe\.exe/u)
  assert.match(source, /pnpm\.cjs/u)
})

test('PowerShell build records native runtime preparation errors', async () => {
  const source = await readFile(resolve(root, 'Build-LDD.ps1'), 'utf8')
  assert.match(source, /prepare-runtime-host\.mjs[^\r\n]*2>&1/u)
  assert.match(source, /Tee-Object/u)
})

test('pnpm permits only the native installers required by the Windows build', async () => {
  const workspace = await readFile(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(workspace, /allowBuilds:\s*\n\s+electron: true\s*\n\s+esbuild: true/u)
  assert.doesNotMatch(workspace, /onlyBuiltDependencies/u)
  assert.doesNotMatch(workspace, /dangerouslyAllowAllBuilds/u)
})

test('GitHub publisher pushes through the user credential manager without force', async () => {
  const source = await readFile(resolve(root, 'Push-to-GitHub.ps1'), 'utf8').catch(() => '')
  assert.match(source, /& \$git clone/u)
  assert.match(source, /& \$git .*add --force --all/u)
  assert.match(source, /& \$git .*push origin main/u)
  assert.doesNotMatch(source, /push[^\r\n]*--force/u)
})

test('Git preserves approved Harness source bytes across Windows checkout', async () => {
  const attributes = await readFile(resolve(root, '.gitattributes'), 'utf8').catch(() => '')
  assert.equal(attributes, '* -text\n')
})

test('runtime assembly invokes the Windows pnpm command shim', async () => {
  const source = await readFile(resolve(root, 'scripts/build-harness-runtime.mjs'), 'utf8')
  assert.match(source, /pnpmExecutable:\s*process\.platform === 'win32' \? 'pnpm\.cmd' : 'pnpm'/u)
})

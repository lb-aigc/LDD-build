import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  assert.match(source, /\.ldd-source-files\.json/u)
  assert.match(source, /Get-ApprovedSourceFiles/u)
  assert.match(source, /& \$git .*add --force --all/u)
  assert.match(source, /& \$git .*push origin main/u)
  assert.doesNotMatch(source, /push[^\r\n]*--force/u)
})

test('GitHub publisher removes files deleted from the approved source while preserving Git metadata', {
  skip: process.platform !== 'win32',
}, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'ldd-github-publisher-'))
  const source = join(fixture, 'source')
  const destination = join(fixture, 'destination')
  try {
    await mkdir(join(destination, '.git'), { recursive: true })
    await mkdir(source, { recursive: true })
    await writeFile(join(destination, '.git', 'config'), 'preserve me\n')
    await writeFile(join(destination, 'obsolete.ts'), 'must be removed\n')
    await writeFile(join(source, 'current.ts'), 'must be copied\n')
    await writeFile(join(source, '.ldd-source-files.json'), `${JSON.stringify({
      formatVersion: 1,
      files: ['.ldd-source-files.json', 'current.ts'],
    }, null, 2)}\n`)
    for (const generated of [
      '.worktrees/private-checkout.txt',
      'dist/build-output.txt',
      'apps/desktop/dist/app-output.txt',
      'packages/runtime-kit/lib/runtime-kit.js',
      'packages/runtime-package/lib/runtime-package.js',
      'packages/video-frame-analyzer/lib/video-plugin.js',
      'apps/desktop/node_modules/local-dependency.txt',
    ]) {
      const path = join(source, ...generated.split('/'))
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, 'must not be published\n')
    }

    await run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'Push-to-GitHub.ps1'),
      '-SourceRoot',
      source,
      '-DestinationRoot',
      destination,
      '-SyncOnly',
    ])

    assert.equal(await readFile(join(destination, 'current.ts'), 'utf8'), 'must be copied\n')
    assert.equal(await readFile(join(destination, '.git', 'config'), 'utf8'), 'preserve me\n')
    await assert.rejects(access(join(destination, 'obsolete.ts')), { code: 'ENOENT' })
    for (const generated of [
      '.worktrees/private-checkout.txt',
      'dist/build-output.txt',
      'apps/desktop/dist/app-output.txt',
      'packages/runtime-kit/lib/runtime-kit.js',
      'packages/runtime-package/lib/runtime-package.js',
      'packages/video-frame-analyzer/lib/video-plugin.js',
      'apps/desktop/node_modules/local-dependency.txt',
    ]) {
      await assert.rejects(access(join(destination, ...generated.split('/'))), { code: 'ENOENT' })
    }
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'pipe' })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} failed with exit ${String(code)}: ${stderr}`)))
  })
}

test('GitHub publisher treats an already-synchronized Scheme A source as success', async () => {
  const source = await readFile(resolve(root, 'Push-to-GitHub.ps1'), 'utf8').catch(() => '')
  assert.match(source, /runtime-lifecycle\.ts/u)
  assert.match(source, /runtime-install-verification\.ts/u)
  assert.match(source, /git -C \$PublishRoot status --porcelain/u)
  assert.match(source, /already contains Scheme A/u)
})

test('Git preserves approved Harness source bytes across Windows checkout', async () => {
  const attributes = await readFile(resolve(root, '.gitattributes'), 'utf8').catch(() => '')
  assert.equal(attributes, '* -text\n')
})

test('runtime assembly invokes the Windows pnpm command shim', async () => {
  const source = await readFile(resolve(root, 'scripts/build-harness-runtime.mjs'), 'utf8')
  assert.match(source, /pnpmExecutable:\s*process\.platform === 'win32' \? 'pnpm\.cmd' : 'pnpm'/u)
})

test('Windows release runs repository verification before packaging', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  assert.equal(
    manifest.scripts?.['verify:release'],
    'pnpm typecheck && pnpm test && node scripts/run-node-verifies.mjs apps packages scripts',
  )
  const workflow = await readFile(resolve(root, '.github/workflows/build-windows.yml'), 'utf8')
  const verification = workflow.indexOf('run: pnpm verify:release')
  const packaging = workflow.indexOf('run: pnpm dist:win')
  assert.notEqual(verification, -1)
  assert.notEqual(packaging, -1)
  assert.ok(verification < packaging, 'repository verification must run before Windows packaging')
})

test('Windows release smoke-tests the installed Harness before artifact upload', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/build-windows.yml'), 'utf8')
  const packaging = workflow.indexOf('run: pnpm dist:win')
  const smoke = workflow.indexOf('name: Smoke-test installed Harness runtime')
  const upload = workflow.indexOf('name: Upload private build artifacts')
  assert.notEqual(packaging, -1)
  assert.notEqual(smoke, -1)
  assert.notEqual(upload, -1)
  assert.ok(packaging < smoke, 'installed Harness smoke test must follow Windows packaging')
  assert.ok(smoke < upload, 'installed Harness smoke test must precede artifact upload')
  assert.match(
    workflow,
    /dist\/runtime\/0\.1\.1-rc\.2\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js/u,
  )
  assert.match(workflow, /& node \$dshEntry --help/u)
})

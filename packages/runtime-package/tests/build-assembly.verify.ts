import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'

import { buildRuntime, type BuildCommandRunner } from '../src/build-runtime.ts'
import { packRuntime } from '../src/pack.ts'
import { approvedHarnessSourceArchiveSha256 } from '../src/source-identity.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const sourceRoot = join(repositoryRoot, 'upstream', 'deepseek-harness')
const pluginRoot = join(repositoryRoot, 'packages', 'video-frame-analyzer')
const patchRoot = join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.1-rc.2')

test('two complete runtime assemblies contain stable relative locks and archived plugin bytes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-runtime-assembly-'))
  try {
    const outputs: Buffer[] = []
    for (const sequence of [1, 2]) {
      const runtimeRoot = join(parent, `runtime-${sequence}`)
      const built = await buildRuntime(sourceRoot, runtimeRoot, {
        sourceArchiveSha256: approvedHarnessSourceArchiveSha256,
        videoPluginRoot: pluginRoot,
        upstreamPatchRoot: patchRoot,
        createdAt: '2026-08-22T00:00:00.000Z',
        requireWindowsHost: false,
        verificationCommands: [],
      }, fakeBuildRunner)
      const manifestPlugin = built.manifest.plugins[0]
      const pluginArchive = await readFile(join(
        runtimeRoot,
        'plugins',
        '@ldd',
        'dsh-video-frame-analyzer.tgz',
      ))
      assert.equal(manifestPlugin?.sha256, sha256(pluginArchive))
      const packageManifest = await readFile(join(runtimeRoot, 'package.json'), 'utf8')
      assert.doesNotMatch(packageManifest, /file:\/\/|\.ldd-runtime-build-/)
      assert.match(packageManifest, /file:packages\//)
      const runtimeWorkspace = await readFile(join(runtimeRoot, 'pnpm-workspace.yaml'), 'utf8')
      assert.match(runtimeWorkspace, /^nodeLinker: hoisted$/mu)
      assert.match(runtimeWorkspace, /^packageImportMethod: copy$/mu)
      assert.match(runtimeWorkspace, /^sharedWorkspaceLockfile: false$/mu)
      assert.match(runtimeWorkspace, /^preferSymlinkedExecutables: false$/mu)
      assert.match(runtimeWorkspace, /'@deepseek-ai\/dsh-subprocess-local': true/u)
      assert.match(
        runtimeWorkspace,
        /'@deepseek-ai\/dsh-subprocess-local@file:packages\/deepseek-ai-dsh-subprocess-local-0\.1\.1-rc\.2\.tgz': true/u,
      )
      assert.match(runtimeWorkspace, /'@google\/genai': false/u)
      const runtimeNpmrc = await readFile(join(runtimeRoot, '.npmrc'), 'utf8')
      assert.doesNotMatch(runtimeNpmrc, /node-linker|package-import-method|shared-workspace-lockfile/u)
      assert.equal(built.pnpmLockPath, join(runtimeRoot, 'pnpm-lock.yaml'))
      const installedDshManifest = JSON.parse(await readFile(join(
        runtimeRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'package.json',
      ), 'utf8')) as { dependencies?: Record<string, string> }
      assert.equal(
        installedDshManifest.dependencies?.['@ldd/dsh-video-frame-analyzer'],
        '0.2.0',
      )
      assert.match(packageManifest, /node-addon-landlock-run/)

      const archive = join(parent, `runtime-${sequence}.lddruntime`)
      await packRuntime(runtimeRoot, archive)
      outputs.push(await readFile(archive))
    }
    assert.deepEqual(outputs[0], outputs[1])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

const fakeBuildRunner: BuildCommandRunner = async (_command, args, options) => {
  if (args.length === 1 && args[0] === '--version') return '11.7.0\n'
  if (
    args[0] === 'install'
    && args.includes('--no-frozen-lockfile')
    && args.includes('--ignore-scripts')
  ) {
    assert.ok(
      args.includes('--prefer-offline'),
      'the copied workspace refresh permits missing registry metadata to be fetched',
    )
    assert.ok(
      !args.includes('--offline'),
      'the copied workspace refresh must not require registry metadata to be pre-cached',
    )
    return ''
  }
  const releaseIndex = args.indexOf('release:pack')
  if (releaseIndex !== -1) {
    assert.notEqual(args[releaseIndex + 1], '--', 'pnpm forwards a literal separator to release:pack')
    const familyIndex = args.indexOf('--family')
    const outIndex = args.indexOf('--out')
    const family = args[familyIndex + 1]
    const out = args[outIndex + 1]
    if (out === undefined) throw new Error('fake release pack has no output')
    const output = join(options.cwd, out)
    await mkdir(output, { recursive: true })
    if (family === 'vendor') {
      await writePackageTarball(output, 'deepseek-ai-cordis-4.0.1.tgz', '@deepseek-ai/cordis', '4.0.1')
    } else if (family === 'dsh') {
      await writePackageTarball(output, 'deepseek-ai-dsh-0.1.1-rc.2.tgz', '@deepseek-ai/dsh', '0.1.1-rc.2')
      await writePackageTarball(
        output,
        'deepseek-ai-dsh-subprocess-local-0.1.1-rc.2.tgz',
        '@deepseek-ai/dsh-subprocess-local',
        '0.1.1-rc.2',
      )
    }
    return ''
  }
  if (args[0] === '--dir' && args[2] === 'build') {
    const config = JSON.parse(await readFile(join(args[1] as string, 'tsconfig.json'), 'utf8')) as {
      extends?: unknown
      compilerOptions?: { moduleResolution?: unknown }
    }
    assert.equal(config.extends, undefined)
    assert.equal(config.compilerOptions?.moduleResolution, 'NodeNext')
    return ''
  }
  if (args[0] === '--dir' && args[2] === 'pack') {
    const destination = args[args.indexOf('--pack-destination') + 1]
    if (destination === undefined) throw new Error('fake package pack has no destination')
    await mkdir(destination, { recursive: true })
    if ((args[1] as string).endsWith(join('landlock-run', 'packages', 'entry'))) {
      await writePackageTarball(
        destination,
        'deepseek-ai-node-addon-landlock-run-0.1.1.tgz',
        '@deepseek-ai/node-addon-landlock-run',
        '0.1.1',
      )
    } else {
      await writePackageTarball(
        destination,
        'ldd-dsh-video-frame-analyzer-0.2.0.tgz',
        '@ldd/dsh-video-frame-analyzer',
        '0.2.0',
      )
    }
    return ''
  }
  if (args[0] === 'install' && basename(options.cwd) === 'runtime') {
    assert.ok(
      args.includes('--prefer-offline'),
      'the final runtime install permits missing package-range metadata to be fetched',
    )
    assert.ok(
      !args.includes('--offline'),
      'the final runtime install must not require all registry metadata to be pre-cached',
    )
    await mkdir(join(options.cwd, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await writeFile(join(options.cwd, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '#!/usr/bin/env node\n')
    await writeFile(join(options.cwd, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      dependencies: {},
    }, null, 2)}\n`)
    await writeFile(join(options.cwd, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies: {}',
      '',
    ].join('\n'))
  }
  return ''
}

async function writePackageTarball(
  directory: string,
  filename: string,
  name: string,
  version: string,
): Promise<void> {
  const data = Buffer.from(`${JSON.stringify({ name, version })}\n`, 'utf8')
  const header = Buffer.alloc(512)
  writeTarString(header, 0, 100, 'package/package.json')
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, data.length)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeTarString(header, 257, 6, 'ustar')
  writeTarString(header, 263, 2, '00')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  writeTarOctal(header, 148, 8, checksum)
  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length)
  const archive = Buffer.concat([header, data, padding, Buffer.alloc(1024)])
  await writeFile(join(directory, filename), gzipSync(archive, { level: 9 }))
}

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, '0')
  buffer.write(encoded, offset, length - 1, 'ascii')
  buffer[offset + length - 1] = 0
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

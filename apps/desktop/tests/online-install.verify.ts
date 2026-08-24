import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { installOnlineRuntime, type OnlineInstallCommandRunner } from '../src/main/runtime/online-install.ts'

test('online runtime install applies pnpm portable layout before dependency installation', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-online-runtime-'))
  try {
    const version = '0.1.1-rc.3'
    const dshArchive = packageTarball('@deepseek-ai/dsh', version)
    const videoPluginArchive = join(parent, 'ldd-video-frame-analyzer.tgz')
    await writeFile(videoPluginArchive, packageTarball('@ldd/dsh-video-frame-analyzer', '0.2.0'))
    const generatePluginArchive = join(parent, 'ldd-generate.tgz')
    await writeFile(generatePluginArchive, packageTarball('@ldd/dsh-generate', '0.2.0'))
    const nodePath = join(parent, 'host', 'node.exe')
    const pnpmPath = join(parent, 'host', 'pnpm.cjs')
    await mkdir(join(parent, 'host'), { recursive: true })
    await writeFile(nodePath, '')
    await writeFile(pnpmPath, '')
    let installObserved = false
    const run: OnlineInstallCommandRunner = async (_executable, args, options) => {
      if (args.includes('install')) {
        installObserved = true
        const workspace = await readFile(join(options.cwd, 'pnpm-workspace.yaml'), 'utf8')
        assert.match(workspace, /^nodeLinker: hoisted$/mu)
        assert.match(workspace, /^packageImportMethod: copy$/mu)
        assert.match(workspace, /^sharedWorkspaceLockfile: false$/mu)
        assert.match(workspace, /^preferSymlinkedExecutables: false$/mu)
        assert.match(workspace, /'@deepseek-ai\/dsh-subprocess-local': true/u)
        assert.match(workspace, /'@google\/genai': false/u)
        assert.match(workspace, /'node-addon-require-builtin': false/u)
        assert.match(workspace, /'protobufjs': false/u)
        assert.match(
          workspace,
          /'@deepseek-ai\/dsh': 'file:packages\/dsh-0\.1\.1-rc\.3\.tgz'/u,
        )
        assert.match(
          workspace,
          /'@ldd\/dsh-video-frame-analyzer': 'file:packages\/ldd-plugin-\d+\.tgz'/u,
        )
        assert.match(
          workspace,
          /'@ldd\/dsh-generate': 'file:packages\/ldd-plugin-\d+\.tgz'/u,
        )
        const npmrc = await readFile(join(options.cwd, '.npmrc'), 'utf8')
        assert.doesNotMatch(npmrc, /node-linker|package-import-method|shared-workspace-lockfile/u)
        await mkdir(join(options.cwd, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
        await writeFile(join(options.cwd, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '')
        await writeFile(join(options.cwd, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), `${JSON.stringify({
          name: '@deepseek-ai/dsh',
          version,
          dependencies: {},
        })}\n`)
        return ''
      }
      if (args.includes('--version')) return `${version}\n`
      return ''
    }

    const installed = await installOnlineRuntime({
      release: {
        version,
        integrity: `sha512-${createHash('sha512').update(dshArchive).digest('base64')}`,
        tarballUrl: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`,
        releaseTag: 'next',
      },
      stagingRoot: join(parent, 'staging'),
      versionsRoot: join(parent, 'versions'),
      host: { nodePath, pnpmPath, pluginArchivePaths: [videoPluginArchive, generatePluginArchive] },
      createdAt: '2026-08-23T00:00:00.000Z',
      desktopVersion: '0.2.0',
      fetchImpl: async () => new Response(new Uint8Array(dshArchive), { status: 200 }),
      run,
    })

    assert.equal(installObserved, true)
    assert.equal(installed.version, version)
    assert.equal(installed.path, join(parent, 'versions', version))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

function packageTarball(name: string, version: string): Buffer {
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
  writeTarOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0))
  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length)
  return gzipSync(Buffer.concat([header, data, padding, Buffer.alloc(1024)]), { level: 9 })
}

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1, 'ascii')
  buffer[offset + length - 1] = 0
}

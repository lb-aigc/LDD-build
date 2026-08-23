import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { BuildCommandRunner } from '../src/build-runtime.ts'
import { runApprovedRuntimeLifecycles } from '../src/runtime-lifecycle.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

interface CapturedCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

describe('approved runtime lifecycle execution', () => {
  it('runs the immutable allowlist with direct Node commands and a compact environment', async () => {
    const root = await fixtureRuntime()
    const calls: CapturedCall[] = []
    const runner = captureRunner(calls)

    await runApprovedRuntimeLifecycles(root, {
      PATH: 'oversized-parent-path',
      HOME: '/home/ldd',
      SYSTEMROOT: 'C:\\Windows',
      NODE_OPTIONS: '--inspect',
    }, runner)

    expect(calls.map(({ command, args, cwd }) => ({ command, args, cwd }))).toEqual([
      {
        command: process.execPath,
        args: ['install.js'],
        cwd: join(root, 'node_modules', 'esbuild'),
      },
      {
        command: process.execPath,
        args: ['./cnoke.cjs', '-P', '.', '-D', 'src/koffi', '--prebuild', '--release'],
        cwd: join(root, 'node_modules', 'koffi'),
      },
      {
        command: process.execPath,
        args: ['scripts/prebuild.js'],
        cwd: join(root, 'node_modules', 'node-pty'),
      },
      {
        command: process.execPath,
        args: ['scripts/post-install.js'],
        cwd: join(root, 'node_modules', 'node-pty'),
      },
      {
        command: process.execPath,
        args: ['scripts/ensure-spawn-helper.mjs'],
        cwd: join(root, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local'),
      },
    ])
    const firstEnvironment = calls[0]?.env
    expect(firstEnvironment?.PATH).not.toContain('oversized-parent-path')
    expect(firstEnvironment?.PATH).toContain(dirname(process.execPath))
    expect(firstEnvironment?.HOME).toBe('/home/ldd')
    expect(firstEnvironment?.NODE_OPTIONS).toBeUndefined()
    expect(firstEnvironment?.CI).toBe('1')
    expect(firstEnvironment?.DSH_TELEMETRY_DISABLED).toBe('1')
  })

  it('validates every installed script before executing any lifecycle', async () => {
    const root = await fixtureRuntime()
    const dshManifest = join(
      root,
      'node_modules',
      '@deepseek-ai',
      'dsh-subprocess-local',
      'package.json',
    )
    const manifest = JSON.parse(await readFile(dshManifest, 'utf8')) as Record<string, unknown>
    manifest.scripts = { postinstall: 'node unexpected.js' }
    await writeFile(dshManifest, `${JSON.stringify(manifest)}\n`)
    const calls: CapturedCall[] = []

    await expect(runApprovedRuntimeLifecycles(root, {}, captureRunner(calls)))
      .rejects.toThrow(/lifecycle policy mismatch.*dsh-subprocess-local.*postinstall/iu)
    expect(calls).toEqual([])
  })

  it('rejects a missing or symbolic-link package before executing any lifecycle', async () => {
    const missingRoot = await fixtureRuntime()
    await rm(join(missingRoot, 'node_modules', 'koffi'), { recursive: true })
    const missingCalls: CapturedCall[] = []
    await expect(runApprovedRuntimeLifecycles(missingRoot, {}, captureRunner(missingCalls)))
      .rejects.toThrow(/approved lifecycle package.*koffi/iu)
    expect(missingCalls).toEqual([])

    const linkedRoot = await fixtureRuntime()
    const esbuild = join(linkedRoot, 'node_modules', 'esbuild')
    const external = join(linkedRoot, 'external-esbuild')
    await rm(esbuild, { recursive: true })
    await mkdir(external)
    await symlink(external, esbuild, 'dir')
    const linkedCalls: CapturedCall[] = []
    await expect(runApprovedRuntimeLifecycles(linkedRoot, {}, captureRunner(linkedCalls)))
      .rejects.toThrow(/approved lifecycle package.*regular directory/iu)
    expect(linkedCalls).toEqual([])
  })

  it('uses the installed node-gyp fallback only after the node-pty prebuild probe fails', async () => {
    const root = await fixtureRuntime()
    const calls: CapturedCall[] = []
    const nodeGyp = join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
    const runner: BuildCommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env })
      if (options.cwd.endsWith('node-pty') && args[0] === 'scripts/prebuild.js') {
        throw new Error('prebuild unavailable')
      }
      return ''
    }

    await runApprovedRuntimeLifecycles(root, {}, runner)

    expect(calls.some((call) => (
      call.command === process.execPath
      && call.args[0] === nodeGyp
      && call.args[1] === 'rebuild'
      && call.cwd === join(root, 'node_modules', 'node-pty')
    ))).toBe(true)
  })
})

function captureRunner(calls: CapturedCall[]): BuildCommandRunner {
  return async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env })
    return ''
  }
}

async function fixtureRuntime(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ldd-runtime-lifecycle-'))
  roots.push(root)
  const packages = [
    {
      name: 'esbuild',
      scripts: { postinstall: 'node install.js' },
      files: ['install.js'],
    },
    {
      name: 'koffi',
      scripts: { install: 'node ./cnoke.cjs -P . -D src/koffi --prebuild --release' },
      files: ['cnoke.cjs'],
    },
    {
      name: 'node-pty',
      scripts: {
        install: 'node scripts/prebuild.js || node-gyp rebuild',
        postinstall: 'node scripts/post-install.js',
      },
      files: ['scripts/prebuild.js', 'scripts/post-install.js'],
    },
    {
      name: '@deepseek-ai/dsh-subprocess-local',
      scripts: { postinstall: 'node scripts/ensure-spawn-helper.mjs' },
      files: ['scripts/ensure-spawn-helper.mjs'],
    },
  ] as const
  for (const entry of packages) {
    const directory = join(root, 'node_modules', ...entry.name.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), `${JSON.stringify({
      name: entry.name,
      scripts: entry.scripts,
    })}\n`)
    for (const file of entry.files) {
      await mkdir(dirname(join(directory, file)), { recursive: true })
      await writeFile(join(directory, file), '')
    }
  }
  const nodeGyp = join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  await mkdir(dirname(nodeGyp), { recursive: true })
  await writeFile(nodeGyp, '')
  return root
}

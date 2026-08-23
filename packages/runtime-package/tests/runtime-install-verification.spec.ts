import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { BuildCommandRunner } from '../src/build-runtime.ts'
import { verifyInstalledRuntime } from '../src/runtime-install-verification.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const dependencies = {
  '@deepseek-ai/cosmokit': 'file:packages/deepseek-ai-cosmokit-1.8.2.tgz',
  '@deepseek-ai/dsh': 'file:packages/deepseek-ai-dsh-0.1.1-rc.2.tgz',
  '@ldd/dsh-video-frame-analyzer': 'file:packages/ldd-dsh-video-frame-analyzer-0.2.0.tgz',
} as const

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('installed runtime verification', () => {
  it('accepts a symlink-free runtime containing only approved local internal snapshots', async () => {
    const root = await fixtureRuntime(localLockfile())

    await expect(verifyInstalledRuntime(root, dependencies, realRunner, {})).resolves.toBeUndefined()
  })

  it('accepts an approved local snapshot with pnpm peer-dependency suffixes', async () => {
    const root = await fixtureRuntime(localLockfile().replace(
      "@deepseek-ai/cosmokit@file:packages/deepseek-ai-cosmokit-1.8.2.tgz",
      "@deepseek-ai/cosmokit@file:packages/deepseek-ai-cosmokit-1.8.2.tgz(@deepseek-ai/cordis-plugin-timer@file:packages/deepseek-ai-cordis-plugin-timer-1.1.3.tgz(@deepseek-ai/cordis@4.0.1))(@deepseek-ai/cordis@4.0.1)",
    ))

    await expect(verifyInstalledRuntime(root, dependencies, realRunner, {})).resolves.toBeUndefined()
  })

  it('rejects a registry snapshot for an approved internal package', async () => {
    const root = await fixtureRuntime([
      localLockfile(),
      "  '@deepseek-ai/cosmokit@1.8.2': {}",
      '',
    ].join('\n'))

    await expect(verifyInstalledRuntime(root, dependencies, realRunner, {}))
      .rejects.toThrow(/registry-backed runtime package.*cosmokit/iu)
  })

  it('rejects an internal snapshot absent from the approved dependency inventory', async () => {
    const root = await fixtureRuntime([
      localLockfile(),
      "  '@deepseek-ai/unapproved@1.0.0': {}",
      '',
    ].join('\n'))

    await expect(verifyInstalledRuntime(root, dependencies, realRunner, {}))
      .rejects.toThrow(/unapproved internal runtime package.*@deepseek-ai\/unapproved/iu)
  })

  it('rejects a symbolic link anywhere in the installed runtime', async () => {
    const root = await fixtureRuntime(localLockfile())
    await symlink(
      join(root, 'node_modules', 'esbuild', 'package.json'),
      join(root, 'node_modules', 'esbuild', 'linked-package.json'),
      'file',
    )

    await expect(verifyInstalledRuntime(root, dependencies, realRunner, {}))
      .rejects.toThrow(/symbolic link.*linked-package\.json/iu)
  })

  it('requires the video plugin and a runnable DSH CLI', async () => {
    const missingPluginRoot = await fixtureRuntime(localLockfile())
    await rm(join(missingPluginRoot, 'node_modules', '@ldd', 'dsh-video-frame-analyzer'), {
      recursive: true,
    })
    await expect(verifyInstalledRuntime(missingPluginRoot, dependencies, realRunner, {}))
      .rejects.toThrow(/video plugin manifest/iu)

    const brokenCliRoot = await fixtureRuntime(localLockfile())
    await writeFile(
      join(brokenCliRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      'process.exit(7)\n',
    )
    await expect(verifyInstalledRuntime(brokenCliRoot, dependencies, realRunner, {}))
      .rejects.toThrow(/exited with code 7/iu)
  })

  it('loads the installed native packages instead of trusting their manifests', async () => {
    const root = await fixtureRuntime(localLockfile())
    await rm(join(root, 'node_modules', 'node-pty', 'index.js'))

    await expect(verifyInstalledRuntime(root, dependencies, realRunner, {}))
      .rejects.toThrow(/native package probe/iu)
  })
})

async function fixtureRuntime(lockfile: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ldd-runtime-verification-'))
  roots.push(root)
  const files = new Map<string, string>([
    ['pnpm-lock.yaml', lockfile],
    ['node_modules/@deepseek-ai/dsh/package.json', '{"name":"@deepseek-ai/dsh"}\n'],
    [
      'node_modules/@deepseek-ai/dsh/lib/bin.js',
      'if (!process.argv.includes("--help")) process.exit(3); console.log("Usage: dsh")\n',
    ],
    [
      'node_modules/@ldd/dsh-video-frame-analyzer/package.json',
      '{"name":"@ldd/dsh-video-frame-analyzer"}\n',
    ],
    ['node_modules/esbuild/package.json', '{"name":"esbuild","type":"module","main":"index.js"}\n'],
    ['node_modules/esbuild/index.js', 'export async function transform() { return { code: "ok" } }\n'],
    ['node_modules/koffi/package.json', '{"name":"koffi","type":"module","main":"index.js"}\n'],
    ['node_modules/koffi/index.js', 'export const loaded = true\n'],
    ['node_modules/node-pty/package.json', '{"name":"node-pty","type":"module","main":"index.js"}\n'],
    ['node_modules/node-pty/index.js', 'export const loaded = true\n'],
  ])
  for (const [relative, content] of files) {
    const path = join(root, ...relative.split('/'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

function localLockfile(): string {
  return [
    "lockfileVersion: '9.0'",
    'packages:',
    "  '@deepseek-ai/cosmokit@file:packages/deepseek-ai-cosmokit-1.8.2.tgz': {}",
    "  '@deepseek-ai/dsh@file:packages/deepseek-ai-dsh-0.1.1-rc.2.tgz': {}",
    "  '@ldd/dsh-video-frame-analyzer@file:packages/ldd-dsh-video-frame-analyzer-0.2.0.tgz': {}",
    'snapshots:',
    "  '@deepseek-ai/cosmokit@file:packages/deepseek-ai-cosmokit-1.8.2.tgz': {}",
    "  '@deepseek-ai/dsh@file:packages/deepseek-ai-dsh-0.1.1-rc.2.tgz': {}",
    "  '@ldd/dsh-video-frame-analyzer@file:packages/ldd-dsh-video-frame-analyzer-0.2.0.tgz': {}",
    '',
  ].join('\n')
}

const realRunner: BuildCommandRunner = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
    })
    return result.stdout
  } catch (error) {
    const exitCode = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'unknown'
    throw new Error(`${command} exited with code ${exitCode}`)
  }
}

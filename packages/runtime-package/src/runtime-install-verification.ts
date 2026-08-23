import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { BuildCommandRunner } from './build-runtime.ts'
import { compactLifecycleEnvironment } from './runtime-lifecycle.ts'

/**
 * Registry-backed platform prebuilds declared as `optionalDependencies` by the
 * landlock-run entry package (`@deepseek-ai/node-addon-landlock-run`). These
 * are `@deepseek-ai/`-scoped by design but are NOT local runtime archives:
 * each is a prebuilt Linux binary published to the npm registry, resolved only
 * as a launcher file path (never imported as JavaScript), and deliberately
 * left registry-only because LDD assembles the Windows x64 runtime — on hosts
 * without a matching binary the entry probe fails closed. They must therefore
 * not trip the unapproved-internal-package check.
 */
const REGISTRY_BACKED_LANDLOCK_PREBUILDS = new Set([
  '@deepseek-ai/node-addon-landlock-run-linux-arm64',
  '@deepseek-ai/node-addon-landlock-run-linux-x64',
])

export async function verifyInstalledRuntime(
  runtimeRoot: string,
  dependencies: Readonly<Record<string, string>>,
  run: BuildCommandRunner,
  baseEnvironment: Readonly<NodeJS.ProcessEnv>,
): Promise<void> {
  await assertTreeContainsNoSymbolicLinks(runtimeRoot)
  const lockfilePath = join(runtimeRoot, 'pnpm-lock.yaml')
  await assertRegularFile(lockfilePath, 'runtime pnpm lock')
  const lockfile = await readFile(lockfilePath, 'utf8')
  verifyInternalPackageSnapshots(lockfile, dependencies)

  const dshEntry = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  await assertRegularFile(dshEntry, 'installed DSH entry')
  await assertRegularFile(
    join(runtimeRoot, 'node_modules', '@ldd', 'dsh-video-frame-analyzer', 'package.json'),
    'installed video plugin manifest',
  )
  for (const packageName of ['esbuild', 'koffi', 'node-pty']) {
    await assertRegularFile(
      join(runtimeRoot, 'node_modules', packageName, 'package.json'),
      `installed native package manifest ${packageName}`,
    )
  }

  try {
    await run(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "const esbuild = await import('esbuild')",
        "const transformed = await esbuild.transform('export const ready = true')",
        "if (typeof transformed.code !== 'string' || transformed.code.length === 0) process.exit(41)",
        "await import('koffi')",
        "await import('node-pty')",
      ].join(';'),
    ], {
      cwd: runtimeRoot,
      env: compactLifecycleEnvironment(runtimeRoot, baseEnvironment),
      captureOutput: true,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`installed native package probe failed: ${reason}`)
  }

  await run(process.execPath, [dshEntry, '--help'], {
    cwd: runtimeRoot,
    env: compactLifecycleEnvironment(runtimeRoot, baseEnvironment),
    captureOutput: true,
  })
}

export function verifyInternalPackageSnapshots(
  lockfile: string,
  dependencies: Readonly<Record<string, string>>,
): void {
  const approvedInternalPackages = new Set(Object.keys(dependencies).filter(
    (name) => name.startsWith('@deepseek-ai/') || name.startsWith('@ldd/'),
  ))
  const internalSnapshot = /^\s{2}'?(@(?:deepseek-ai|ldd)\/[A-Za-z0-9._+-]+)@/gmu
  for (const match of lockfile.matchAll(internalSnapshot)) {
    const name = match[1]
    if (
      name !== undefined &&
      !approvedInternalPackages.has(name) &&
      !REGISTRY_BACKED_LANDLOCK_PREBUILDS.has(name)
    ) {
      throw new Error(`unapproved internal runtime package detected in lockfile: ${name}`)
    }
  }
  for (const [name, target] of Object.entries(dependencies)) {
    if (!name.startsWith('@deepseek-ai/') && !name.startsWith('@ldd/')) continue
    if (!/^file:packages\/[A-Za-z0-9._-]+\.tgz$/u.test(target)) {
      throw new Error(`approved internal runtime package ${name} has a non-local dependency target`)
    }
    const snapshot = new RegExp(`^\\s{2}'?${escapeRegExp(name)}@([^'\\n]+)'?:`, 'gmu')
    const matches = [...lockfile.matchAll(snapshot)]
    if (matches.length === 0) {
      throw new Error(`runtime lockfile is missing approved local package ${name}`)
    }
    for (const match of matches) {
      const resolved = match[1]
      if (resolved === undefined) {
        throw new Error(`runtime lockfile snapshot for ${name} is malformed`)
      }
      if (!isApprovedLocalSnapshot(resolved, target)) {
        throw new Error(
          `registry-backed runtime package detected for ${name}: expected ${target}, received ${String(resolved)}`,
        )
      }
    }
  }
}

function isApprovedLocalSnapshot(resolved: string, target: string): boolean {
  if (resolved === target) return true
  if (!resolved.startsWith(target)) return false
  const peerSuffix = resolved.slice(target.length)
  if (!peerSuffix.startsWith('(')) return false
  let depth = 0
  for (let index = 0; index < peerSuffix.length; index += 1) {
    const character = peerSuffix[index]
    if (character === '(') {
      depth += 1
      if (peerSuffix[index + 1] === ')') return false
      continue
    }
    if (character === ')') {
      if (depth === 0) return false
      depth -= 1
      if (depth === 0 && index + 1 < peerSuffix.length && peerSuffix[index + 1] !== '(') return false
      continue
    }
    if (depth === 0 || character === "'" || character === '\n' || character === '\r') return false
  }
  return depth === 0
}

async function assertTreeContainsNoSymbolicLinks(root: string): Promise<void> {
  const queue = [root]
  while (queue.length > 0) {
    const directory = queue.shift()
    if (directory === undefined) break
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`runtime contains symbolic link: ${path}`)
      if (entry.isDirectory()) queue.push(path)
    }
  }
}

async function assertRegularFile(path: string, field: string): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isSymbolicLink() && metadata.isFile()) return
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  throw new Error(`${field} must be a regular file`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

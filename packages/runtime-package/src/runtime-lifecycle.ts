import { lstat, readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

import type { BuildCommandRunner } from './build-runtime.ts'

interface LifecycleCommand {
  readonly args: readonly string[]
}

interface LifecyclePolicy {
  readonly packageName: string
  readonly phase: 'install' | 'postinstall'
  readonly expectedScript: string
  readonly command: LifecycleCommand
  readonly fallback?: 'node-gyp-rebuild'
}

export const approvedRuntimeLifecycles: readonly LifecyclePolicy[] = Object.freeze([
  {
    packageName: 'esbuild',
    phase: 'postinstall',
    expectedScript: 'node install.js',
    command: { args: ['install.js'] },
  },
  {
    packageName: 'koffi',
    phase: 'install',
    expectedScript: 'node ./cnoke.cjs -P . -D src/koffi --prebuild --release',
    command: { args: ['./cnoke.cjs', '-P', '.', '-D', 'src/koffi', '--prebuild', '--release'] },
  },
  {
    packageName: 'node-pty',
    phase: 'install',
    expectedScript: 'node scripts/prebuild.js || node-gyp rebuild',
    command: { args: ['scripts/prebuild.js'] },
    fallback: 'node-gyp-rebuild',
  },
  {
    packageName: 'node-pty',
    phase: 'postinstall',
    expectedScript: 'node scripts/post-install.js',
    command: { args: ['scripts/post-install.js'] },
  },
  {
    packageName: '@deepseek-ai/dsh-subprocess-local',
    phase: 'postinstall',
    expectedScript: 'node scripts/ensure-spawn-helper.mjs',
    command: { args: ['scripts/ensure-spawn-helper.mjs'] },
  },
])

interface ValidatedLifecycle {
  readonly policy: LifecyclePolicy
  readonly packageRoot: string
}

export async function runApprovedRuntimeLifecycles(
  runtimeRoot: string,
  baseEnvironment: Readonly<NodeJS.ProcessEnv>,
  run: BuildCommandRunner,
  nodeExecutable: string = process.execPath,
): Promise<void> {
  const validated: ValidatedLifecycle[] = []
  for (const policy of approvedRuntimeLifecycles) {
    const packageRoot = join(runtimeRoot, 'node_modules', ...policy.packageName.split('/'))
    await assertRegularDirectory(packageRoot, `approved lifecycle package ${policy.packageName}`)
    const manifestPath = join(packageRoot, 'package.json')
    await assertRegularFile(manifestPath, `approved lifecycle manifest ${policy.packageName}`)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new Error(`approved lifecycle manifest ${policy.packageName} is invalid`)
    }
    const record = manifest as Record<string, unknown>
    if (record.name !== policy.packageName) {
      throw new Error(`approved lifecycle package identity mismatch for ${policy.packageName}`)
    }
    const scripts = record.scripts
    const actual = typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>)[policy.phase]
      : undefined
    if (actual !== policy.expectedScript) {
      throw new Error(
        `lifecycle policy mismatch for ${policy.packageName} ${policy.phase}: ` +
        `expected ${JSON.stringify(policy.expectedScript)}, received ${JSON.stringify(actual)}`,
      )
    }
    const entry = policy.command.args[0]
    if (entry === undefined) throw new Error(`approved lifecycle command is empty for ${policy.packageName}`)
    await assertRegularFile(
      join(packageRoot, entry),
      `approved lifecycle entry ${policy.packageName} ${policy.phase}`,
    )
    validated.push({ policy, packageRoot })
  }

  const environment = compactLifecycleEnvironment(runtimeRoot, baseEnvironment, process.platform, nodeExecutable)
  for (const { policy, packageRoot } of validated) {
    try {
      await run(nodeExecutable, policy.command.args, {
        cwd: packageRoot,
        env: environment,
      })
    } catch (error) {
      if (policy.fallback !== 'node-gyp-rebuild') throw error
      const nodeGyp = join(runtimeRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
      await assertRegularFile(nodeGyp, 'node-pty fallback node-gyp entry')
      await run(nodeExecutable, [nodeGyp, 'rebuild'], {
        cwd: packageRoot,
        env: environment,
      })
    }
  }
}

export function compactLifecycleEnvironment(
  runtimeRoot: string,
  baseEnvironment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = process.execPath,
): NodeJS.ProcessEnv {
  const preserved = new Set([
    'ALL_PROXY', 'APPDATA', 'COMSPEC', 'HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'LANG', 'LC_ALL',
    'LOCALAPPDATA', 'NO_PROXY', 'PATHEXT', 'PROGRAMDATA', 'SYSTEMDRIVE', 'SYSTEMROOT',
    'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
  ])
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(baseEnvironment)) {
    if (value !== undefined && preserved.has(key.toUpperCase())) environment[key] = value
  }
  const systemRoot = environmentValue(environment, 'SYSTEMROOT') ?? environmentValue(environment, 'WINDIR')
  const pathEntries = [
    dirname(nodeExecutable),
    join(runtimeRoot, 'node_modules', '.bin'),
  ]
  if (platform === 'win32' && systemRoot !== undefined) {
    pathEntries.push(
      join(systemRoot, 'System32'),
      systemRoot,
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    )
  } else {
    pathEntries.push('/usr/bin', '/bin')
  }
  environment.PATH = pathEntries.join(platform === 'win32' ? ';' : delimiter)
  environment.CI = '1'
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

async function assertRegularDirectory(path: string, field: string): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isSymbolicLink() && metadata.isDirectory()) return
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  throw new Error(`${field} must be a regular directory`)
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

function environmentValue(environment: Readonly<NodeJS.ProcessEnv>, name: string): string | undefined {
  return Object.entries(environment).find(([key]) => key.toUpperCase() === name)?.[1]
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

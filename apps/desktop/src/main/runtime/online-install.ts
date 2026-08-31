import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'

import {
  wireRuntimeExtensionIntoDsh,
  writePortableRuntimePnpmConfig,
  writeRuntimeMetadata,
} from '@ldd/runtime-package'
import { sha256File } from '@ldd/runtime-kit/checksum'

import type { RuntimeProgressEvent } from '../ipc/contracts.ts'
import type { InstalledRuntime } from './installer.ts'
import { validateOnlineRelease } from './online-release.ts'
import type { ResolvedRuntimeRelease } from './registry.ts'
import { RuntimeTransaction } from './transaction.ts'

const maxHarnessTarballBytes = 128 * 1024 * 1024

export interface OnlineRuntimeHost {
  readonly nodePath: string
  readonly pnpmPath: string
  readonly pluginArchivePaths: readonly string[]
}

export interface OnlineRuntimeInstallOptions {
  readonly release: ResolvedRuntimeRelease
  readonly stagingRoot: string
  readonly versionsRoot: string
  readonly host: OnlineRuntimeHost
  readonly createdAt: string
  readonly desktopVersion: string
  readonly fetchImpl?: typeof fetch
  readonly run?: OnlineInstallCommandRunner
  readonly onProgress?: (event: RuntimeProgressEvent) => void | Promise<void>
}

export type OnlineInstallCommandRunner = (
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
) => Promise<string>

export async function installOnlineRuntime(
  options: OnlineRuntimeInstallOptions,
): Promise<InstalledRuntime> {
  validateOnlineRelease(options.release)
  const installedPath = resolveVersionPath(options.versionsRoot, options.release.version)
  await assertMissing(installedPath)
  const transaction = await RuntimeTransaction.create(options.stagingRoot)
  const payload = transaction.childPath('payload')
  const run = options.run ?? runCommand
  try {
    await transaction.transition('extracting')
    await progress(options, 'download', 10, `正在下载 Harness ${options.release.version}`)
    await mkdir(join(payload, 'packages'), { mode: 0o700, recursive: true })
    const dshArchive = join(payload, 'packages', `dsh-${options.release.version}.tgz`)
    const sourceArchiveSha256 = await downloadVerifiedTarball(
      options.release,
      dshArchive,
      options.fetchImpl ?? fetch,
    )
    interface StagedPlugin {
      readonly name: string
      readonly version: string
      readonly filename: string
      readonly stagedPath: string
    }
    const stagedPlugins: StagedPlugin[] = []
    for (const [index, pluginArchivePath] of options.host.pluginArchivePaths.entries()) {
      const filename = `ldd-plugin-${String(index)}.tgz`
      const stagedPath = join(payload, 'packages', filename)
      await copyRegularFile(pluginArchivePath, stagedPath, 'bundled LDD plugin archive')
      const identity = await readPackedIdentity(stagedPath)
      if (!identity.name.startsWith('@ldd/dsh-')) {
        throw new Error(`bundled LDD plugin archive identity is invalid: ${identity.name}`)
      }
      stagedPlugins.push({ name: identity.name, version: identity.version, filename, stagedPath })
    }

    await transaction.transition('verifying')
    const pluginDependencies = Object.fromEntries(stagedPlugins.map((plugin) => [
      plugin.name,
      `file:packages/${plugin.filename}`,
    ]))
    const dependencies = {
      '@deepseek-ai/dsh': `file:packages/${basename(dshArchive)}`,
      ...pluginDependencies,
    }
    await writeFile(join(payload, 'package.json'), `${JSON.stringify({
      name: '@ldd/online-harness-runtime',
      version: options.release.version,
      private: true,
      type: 'module',
      dependencies,
    }, null, 2)}\n`, { mode: 0o600 })
    await writePortableRuntimePnpmConfig(payload, {
      '@deepseek-ai/dsh-subprocess-local': true,
      '@google/genai': false,
      esbuild: true,
      'node-pty': true,
      koffi: true,
      'node-addon-require-builtin': false,
      protobufjs: false,
    }, dependencies)

    await progress(options, 'install', 45, '正在安装精确版本依赖')
    const command = pnpmCommand(options.host)
    await run(command.executable, [
      ...command.prefix,
      'install',
      '--prod',
      '--no-frozen-lockfile',
    ], { cwd: payload, env: installerEnvironment(options.host) })
    const dshEntry = join(payload, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await assertRegularFile(dshEntry, 'installed dsh entry')
    const reported = (await run(options.host.nodePath, [dshEntry, '--version'], {
      cwd: payload,
      env: installerEnvironment(options.host),
    })).trim()
    if (reported !== options.release.version) {
      throw new Error(`installed Harness reports ${JSON.stringify(reported)}, expected ${options.release.version}`)
    }
    for (const plugin of stagedPlugins) {
      await wireRuntimeExtensionIntoDsh(payload, plugin.name, plugin.version)
    }
    await assertDurablePluginEventSupport(options.host.nodePath, payload, run, options.host)

    await transaction.transition('health-checking')
    await progress(options, 'verify', 75, '正在生成并核对运行包清单')
    const manifestPlugins: Array<{ readonly name: string; readonly version: string; readonly sha256: string }> = []
    for (const plugin of stagedPlugins) {
      const pluginArchive = join(payload, 'plugins', '@ldd', `${plugin.name.slice('@ldd/'.length)}.tgz`)
      await mkdir(dirname(pluginArchive), { mode: 0o700, recursive: true })
      await copyRegularFile(plugin.stagedPath, pluginArchive, 'staged LDD plugin archive')
      manifestPlugins.push({
        name: plugin.name,
        version: plugin.version,
        sha256: await sha256File(pluginArchive),
      })
    }
    const manifest = await writeRuntimeMetadata(payload, {
      harnessVersion: options.release.version,
      createdAt: options.createdAt,
      minimumLddVersion: options.desktopVersion,
      sourceArchiveSha256,
      npmIntegrity: options.release.integrity,
      plugins: manifestPlugins,
    })
    await mkdir(options.versionsRoot, { mode: 0o700, recursive: true })
    await rename(payload, installedPath)
    await transaction.transition('installed')
    await progress(options, 'installed', 100, `Harness ${options.release.version} 已安装，等待切换`)
    return { version: options.release.version, path: installedPath, manifest }
  } catch (error) {
    if (transaction.state !== 'failed') await transaction.transition('failed').catch(() => undefined)
    throw error
  } finally {
    await transaction.cleanup()
  }
}

async function downloadVerifiedTarball(
  release: ResolvedRuntimeRelease,
  destination: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(release.tarballUrl, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok || response.body === null) {
    throw new Error(`Harness tarball download returned HTTP ${response.status}`)
  }
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  const output = await open(destination, 'wx', 0o600)
  let size = 0
  let position = 0
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > maxHarnessTarballBytes) throw new Error('Harness tarball exceeds the 128 MiB limit')
      sha256.update(bytes)
      sha512.update(bytes)
      let offset = 0
      while (offset < bytes.length) {
        const result = await output.write(bytes, offset, bytes.length - offset, position)
        if (result.bytesWritten === 0) throw new Error('Harness download write made no progress')
        offset += result.bytesWritten
        position += result.bytesWritten
      }
    }
    await output.sync()
  } finally {
    await output.close()
  }
  const integrity = `sha512-${sha512.digest('base64')}`
  if (integrity !== release.integrity) throw new Error('Harness tarball integrity does not match the registry')
  return sha256.digest('hex')
}

async function assertDurablePluginEventSupport(
  nodePath: string,
  cwd: string,
  run: OnlineInstallCommandRunner,
  host: OnlineRuntimeHost,
): Promise<void> {
  const probe = [
    "await import('@ldd/dsh-video-frame-analyzer')",
    "import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'",
    "if (!KNOWN_SESSION_EVENT_TYPES.has('video/analysis-input')) process.exit(42)",
  ].join(';')
  try {
    await run(nodePath, ['--input-type=module', '--eval', probe], {
      cwd,
      env: installerEnvironment(host),
    })
  } catch {
    throw new Error('candidate Harness cannot durably reload LDD video analysis inputs')
  }
}

function pnpmCommand(host: OnlineRuntimeHost): { readonly executable: string; readonly prefix: readonly string[] } {
  return /\.[cm]?js$/iu.test(host.pnpmPath)
    ? { executable: host.nodePath, prefix: [host.pnpmPath] }
    : { executable: host.pnpmPath, prefix: [] }
}

function installerEnvironment(host: OnlineRuntimeHost): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of [
    'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
    'NODE_EXTRA_CA_CERTS',
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
  environment.PATH = [
    dirname(host.nodePath),
    dirname(host.pnpmPath),
    ...(systemRoot === undefined ? [] : [join(systemRoot, 'System32')]),
  ].join(process.platform === 'win32' ? ';' : ':')
  environment.CI = '1'
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

function resolveVersionPath(versionsRoot: string, version: string): string {
  const root = resolve(versionsRoot)
  const target = resolve(root, version)
  if (!target.startsWith(`${root}${sep}`)) throw new Error('online runtime version path escapes its root')
  return target
}

async function copyRegularFile(source: string, destination: string, field: string): Promise<void> {
  await assertRegularFile(source, field)
  await copyFile(source, destination)
  await assertRegularFile(destination, `copied ${field}`)
}

async function assertRegularFile(path: string, field: string): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${field} must be a regular file`)
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`runtime version is already installed: ${basename(path)}`)
}

async function readPackedIdentity(path: string): Promise<{ readonly name: string; readonly version: string }> {
  const { gunzipSync } = await import('node:zlib')
  const archive = gunzipSync(await readFile(path))
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header.subarray(0, 100))
    const encodedSize = tarString(header.subarray(124, 136)).trim() || '0'
    if (!/^[0-7]+$/u.test(encodedSize)) throw new Error('bundled video plugin archive has an invalid tar size')
    const size = Number.parseInt(encodedSize, 8)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (!Number.isSafeInteger(size) || dataEnd > archive.length) {
      throw new Error('bundled video plugin archive is truncated')
    }
    if (name === 'package/package.json') {
      const manifest = JSON.parse(archive.subarray(dataStart, dataEnd).toString('utf8')) as Record<string, unknown>
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') break
      return { name: manifest.name, version: manifest.version }
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new Error('bundled video plugin archive has no package identity')
}

function tarString(data: Buffer): string {
  const end = data.indexOf(0)
  return data.subarray(0, end === -1 ? data.length : end).toString('utf8')
}

async function progress(
  options: OnlineRuntimeInstallOptions,
  phase: string,
  percent: number,
  message: string,
): Promise<void> {
  await options.onProgress?.({ phase, percent, message })
}

async function runCommand(
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): Promise<string> {
  return await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout = boundedTail(stdout + chunk) })
    child.stderr.on('data', (chunk: string) => { stderr = boundedTail(stderr + chunk) })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolveOutput(stdout)
      else reject(new Error(`runtime command failed (${String(code)}/${String(signal)}): ${stderr.trim()}`))
    })
  })
}

function boundedTail(value: string): string {
  return value.length <= 64 * 1024 ? value : value.slice(-64 * 1024)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

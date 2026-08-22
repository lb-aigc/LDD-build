import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { compareRuntimeNames } from '@ldd/runtime-kit/runtime-manifest'

import {
  writeRuntimeMetadata,
  type RuntimeManifest,
} from './manifest.ts'
import { applyTrackedUpstreamPatches } from './upstream-patches.ts'
import { assertApprovedHarnessSource } from './source-identity.ts'

const expectedPnpm = 'pnpm@11.7.0'
const expectedNodeMajor = 24
const defaultHarnessVersion = '0.1.1-rc.2'

export interface BuildCommand {
  readonly command: string
  readonly args: readonly string[]
}

export interface BuildRuntimeOptions {
  readonly sourceArchiveSha256: string
  readonly videoPluginRoot: string
  readonly upstreamPatchRoot: string
  readonly createdAt: string
  readonly minimumLddVersion?: string
  readonly harnessVersion?: string
  readonly pnpmExecutable?: string
  readonly verificationCommands?: readonly BuildCommand[]
  readonly requireWindowsHost?: boolean
  readonly environment?: Readonly<NodeJS.ProcessEnv>
}

export interface BuildRuntimeResult {
  readonly runtimeRoot: string
  readonly manifest: RuntimeManifest
  readonly pnpmLockPath: string
  readonly dshEntryPath: string
}

export type BuildCommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly captureOutput?: boolean },
) => Promise<string>

export async function buildRuntime(
  sourceRoot: string,
  outputRoot: string,
  options: BuildRuntimeOptions,
  run: BuildCommandRunner = runCommand,
): Promise<BuildRuntimeResult> {
  validateBuildInputs(sourceRoot, outputRoot, options)
  const requireWindowsHost = options.requireWindowsHost ?? true
  if (requireWindowsHost && (process.platform !== 'win32' || process.arch !== 'x64')) {
    throw new Error('the Windows x64 Harness runtime must be assembled on a Windows x64 host')
  }
  if (Number(process.versions.node.split('.', 1)[0]) !== expectedNodeMajor) {
    throw new Error(`Harness runtime assembly requires Node ${expectedNodeMajor}`)
  }
  const outputParent = dirname(resolve(outputRoot))
  await mkdir(outputParent, { mode: 0o700, recursive: true })
  await assertMissing(outputRoot, 'runtime output root')
  const transaction = await mkdtemp(join(outputParent, '.ldd-runtime-build-'))
  const copiedSource = join(transaction, 'source')
  const runtimeRoot = join(transaction, 'runtime')
  const pnpmStore = join(transaction, 'pnpm-store')
  const pnpm = options.pnpmExecutable ?? 'pnpm'
  const environment = controlledBuildEnvironment(options.environment)

  try {
    await assertApprovedHarnessSource(sourceRoot, options.sourceArchiveSha256)
    const pnpmVersion = await run(pnpm, ['--version'], {
      cwd: sourceRoot,
      env: environment,
      captureOutput: true,
    })
    if (pnpmVersion.trim() !== '11.7.0') {
      throw new Error(`Harness runtime assembly requires pnpm 11.7.0, received ${JSON.stringify(pnpmVersion.trim())}`)
    }
    await copyOfficialSource(sourceRoot, copiedSource)
    const sourceManifest = JSON.parse(await readFile(join(copiedSource, 'package.json'), 'utf8')) as {
      version?: unknown
      packageManager?: unknown
    }
    const harnessVersion = options.harnessVersion ?? defaultHarnessVersion
    if (sourceManifest.version !== harnessVersion) {
      throw new Error(`Harness source version is ${String(sourceManifest.version)}, expected ${harnessVersion}`)
    }
    if (sourceManifest.packageManager !== expectedPnpm) {
      throw new Error(`Harness source must pin ${expectedPnpm}`)
    }

    const appliedPatches = await applyTrackedUpstreamPatches(copiedSource, options.upstreamPatchRoot)

    await run(pnpm, ['install', '--frozen-lockfile', '--store-dir', pnpmStore], {
      cwd: copiedSource,
      env: environment,
    })
    for (const verification of options.verificationCommands ?? defaultVerificationCommands(pnpm)) {
      await run(verification.command, verification.args, { cwd: copiedSource, env: environment })
    }
    await run(pnpm, ['run', 'build:official'], { cwd: copiedSource, env: environment })

    const packedRoot = join(copiedSource, 'dist', 'ldd-runtime-npm')
    const vendorTarballs = join(packedRoot, 'vendor')
    const dshTarballs = join(packedRoot, 'dsh')
    const landlockTarballs = join(packedRoot, 'landlock')
    const lddTarballs = join(packedRoot, 'ldd')
    await run(pnpm, ['run', 'release:pack', '--family', 'vendor', '--out', relativeFrom(copiedSource, vendorTarballs)], {
      cwd: copiedSource,
      env: environment,
    })
    await run(pnpm, ['run', 'release:pack', '--family', 'dsh', '--out', relativeFrom(copiedSource, dshTarballs)], {
      cwd: copiedSource,
      env: environment,
    })
    const landlockRoot = join(copiedSource, 'native', 'landlock-run')
    const landlockEntry = join(landlockRoot, 'packages', 'entry')
    await run(pnpm, ['--dir', landlockRoot, 'run', 'build:ts'], {
      cwd: copiedSource,
      env: environment,
    })
    await mkdir(landlockTarballs, { recursive: true })
    await run(pnpm, ['--dir', landlockEntry, 'pack', '--pack-destination', landlockTarballs], {
      cwd: copiedSource,
      env: environment,
    })

    // Keep the downstream package out of the official release-family glob.
    // Official tarballs are complete before the copied workspace gains @ldd/*.
    const pluginWorkspace = join(copiedSource, 'packages', 'ldd', 'video-frame-analyzer')
    await cp(resolve(options.videoPluginRoot), pluginWorkspace, {
      recursive: true,
      filter: (path) => !isExcludedBuildPath(path, resolve(options.videoPluginRoot)),
    })
    await rewriteCopiedPluginTsconfig(pluginWorkspace)
    await run(pnpm, ['install', '--offline', '--no-frozen-lockfile', '--ignore-scripts', '--store-dir', pnpmStore], {
      cwd: copiedSource,
      env: environment,
    })
    await run(pnpm, ['--dir', pluginWorkspace, 'build'], { cwd: copiedSource, env: environment })
    await mkdir(lddTarballs, { recursive: true })
    await run(pnpm, ['--dir', pluginWorkspace, 'pack', '--pack-destination', lddTarballs], {
      cwd: copiedSource,
      env: environment,
    })

    const tarballs = await discoverTarballs([
      vendorTarballs,
      dshTarballs,
      landlockTarballs,
      lddTarballs,
    ])
    await mkdir(runtimeRoot, { mode: 0o700, recursive: true })
    const runtimePackages = join(runtimeRoot, 'packages')
    await mkdir(runtimePackages, { recursive: true })
    const installedTarballs = new Map<string, string>()
    for (const tarball of tarballs) {
      const filename = basename(tarball.path)
      if (!/^[A-Za-z0-9._-]+\.tgz$/u.test(filename)) throw new Error(`unsafe packed filename: ${filename}`)
      const destination = join(runtimePackages, filename)
      await copyFile(tarball.path, destination)
      installedTarballs.set(tarball.name, destination)
    }
    const dependencies = Object.fromEntries(tarballs.map((tarball) => [
      tarball.name,
      `file:packages/${basename(tarball.path)}`,
    ]))
    await writeFile(join(runtimeRoot, 'package.json'), `${JSON.stringify({
      name: '@ldd/harness-runtime',
      version: harnessVersion,
      private: true,
      type: 'module',
      dependencies,
    }, null, 2)}\n`, { mode: 0o600 })
    await writeFile(join(runtimeRoot, '.npmrc'), [
      'node-linker=hoisted',
      'package-import-method=copy',
      'shared-workspace-lockfile=false',
      '',
    ].join('\n'), { mode: 0o600 })
    await writeFile(join(runtimeRoot, 'pnpm-workspace.yaml'), [
      'packages: []',
      'allowBuilds:',
      '  esbuild: true',
      '  node-pty: true',
      '  koffi: true',
      '  node-addon-require-builtin: false',
      '  protobufjs: false',
      '',
    ].join('\n'), { mode: 0o600 })
    await run(pnpm, [
      'install',
      '--prod',
      '--offline',
      '--no-frozen-lockfile',
      '--store-dir',
      pnpmStore,
    ], { cwd: runtimeRoot, env: environment })

    const pluginTarball = requireTarball(tarballs, '@ldd/dsh-video-frame-analyzer')
    await wireRuntimeExtensionIntoDsh(runtimeRoot, pluginTarball.name, pluginTarball.version)

    for (const legalFile of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      await copyFile(join(copiedSource, legalFile), join(runtimeRoot, legalFile))
    }
    await mkdir(join(runtimeRoot, 'ldd'), { recursive: true })
    await writeFile(join(runtimeRoot, 'ldd', 'upstream-patches.json'), `${JSON.stringify({
      harnessVersion,
      patches: appliedPatches,
    }, null, 2)}\n`, { mode: 0o600 })
    const dshTarball = requireTarball(tarballs, '@deepseek-ai/dsh')
    const installedDshTarball = requireInstalledTarball(installedTarballs, dshTarball.name)
    const installedPluginTarball = requireInstalledTarball(installedTarballs, pluginTarball.name)
    const pluginArchive = join(runtimeRoot, 'plugins', '@ldd', 'dsh-video-frame-analyzer.tgz')
    await mkdir(dirname(pluginArchive), { recursive: true })
    await copyFile(installedPluginTarball, pluginArchive)
    const manifest = await writeRuntimeMetadata(runtimeRoot, {
      harnessVersion,
      createdAt: options.createdAt,
      minimumLddVersion: options.minimumLddVersion ?? '0.2.0',
      sourceArchiveSha256: options.sourceArchiveSha256,
      npmIntegrity: `sha512-${await hashFileBase64(installedDshTarball, 'sha512')}`,
      plugins: [{
        name: pluginTarball.name,
        version: pluginTarball.version,
        sha256: await hashFileHex(pluginArchive, 'sha256'),
      }],
    })
    const dshEntryPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await assertRegularFile(dshEntryPath, 'installed dsh entry')
    const pnpmLockPath = join(runtimeRoot, 'pnpm-lock.yaml')
    await assertRegularFile(pnpmLockPath, 'runtime pnpm lock')

    await rename(runtimeRoot, resolve(outputRoot))
    return {
      runtimeRoot: resolve(outputRoot),
      manifest,
      pnpmLockPath: join(resolve(outputRoot), 'pnpm-lock.yaml'),
      dshEntryPath: join(resolve(outputRoot), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    }
  } finally {
    await rm(transaction, { recursive: true, force: true })
  }
}

/**
 * Make an LDD extension part of the installed dsh dependency closure. Harness
 * builds `$DSH_HOME/profiles/node_modules` by walking this manifest, so merely
 * hoisting the extension beside dsh is insufficient for real Profile loading.
 */
export async function wireRuntimeExtensionIntoDsh(
  runtimeRoot: string,
  packageName: string,
  packageVersion: string,
): Promise<void> {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
    throw new TypeError('runtime extension package name is invalid')
  }
  if (packageVersion.length === 0 || packageVersion.length > 128) {
    throw new TypeError('runtime extension package version is invalid')
  }
  const dshManifestPath = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'package.json',
  )
  await assertRegularFile(dshManifestPath, 'installed dsh manifest')
  const parsed = JSON.parse(await readFile(dshManifestPath, 'utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('installed dsh manifest is invalid')
  }
  const manifest = parsed as Record<string, unknown>
  if (manifest.name !== '@deepseek-ai/dsh') {
    throw new Error('installed dsh manifest identity is invalid')
  }
  const dependencies = manifest.dependencies
  if (dependencies !== undefined && (
    typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)
  )) {
    throw new Error('installed dsh dependencies are invalid')
  }
  manifest.dependencies = {
    ...(dependencies as Record<string, unknown> | undefined),
    [packageName]: packageVersion,
  }
  const temporary = `${dshManifestPath}.ldd-${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, dshManifestPath)
}

interface PackedPackage {
  readonly name: string
  readonly version: string
  readonly path: string
}

async function discoverTarballs(directories: readonly string[]): Promise<PackedPackage[]> {
  const packages = new Map<string, PackedPackage>()
  for (const directory of directories) {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.tgz')).sort(compareRuntimeNames)
    if (names.length === 0) throw new Error(`runtime pack directory contains no tarballs: ${directory}`)
    for (const filename of names) {
      const path = join(directory, filename)
      const identity = await readTarballIdentity(path)
      if (packages.has(identity.name)) throw new Error(`duplicate packed package: ${identity.name}`)
      packages.set(identity.name, { ...identity, path })
    }
  }
  return [...packages.values()].sort((left, right) => compareRuntimeNames(left.name, right.name))
}

async function readTarballIdentity(path: string): Promise<{ readonly name: string; readonly version: string }> {
  const archive = gunzipSync(await readFile(path))
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header.subarray(0, 100))
    const prefix = tarString(header.subarray(345, 500))
    const fullName = prefix.length === 0 ? name : `${prefix}/${name}`
    const size = tarOctal(header.subarray(124, 136))
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > archive.length) throw new Error(`truncated package tarball: ${basename(path)}`)
    if (fullName === 'package/package.json') {
      const manifest = JSON.parse(archive.subarray(dataStart, dataEnd).toString('utf8')) as {
        name?: unknown
        version?: unknown
      }
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
        throw new Error(`package tarball has invalid identity: ${basename(path)}`)
      }
      return { name: manifest.name, version: manifest.version }
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new Error(`package tarball has no package/package.json: ${basename(path)}`)
}

function tarString(data: Buffer): string {
  const end = data.indexOf(0)
  return data.subarray(0, end === -1 ? data.length : end).toString('utf8')
}

function tarOctal(data: Buffer): number {
  const value = tarString(data).trim().replace(/^0+/, '')
  if (!/^[0-7]*$/.test(value)) throw new Error('package tarball contains an invalid size')
  const parsed = value.length === 0 ? 0 : Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('package tarball size is unsafe')
  return parsed
}

function defaultVerificationCommands(pnpm: string): readonly BuildCommand[] {
  return [{
    command: pnpm,
    args: [
      'exec',
      'vitest',
      'run',
      'packages/llm/llm-deepseek/tests/adapter.spec.ts',
      'packages/attachment/attachment-local/tests/request-image-verification.spec.ts',
      'packages/boot/app-boot/tests/profile.spec.ts',
    ],
  }]
}

async function copyOfficialSource(sourceRoot: string, destination: string): Promise<void> {
  const source = resolve(sourceRoot)
  await assertDirectory(source, 'Harness source root')
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => !isExcludedBuildPath(path, source),
  })
}

async function rewriteCopiedPluginTsconfig(pluginWorkspace: string): Promise<void> {
  await writeFile(join(pluginWorkspace, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      lib: ['ES2023', 'ESNext.Disposable'],
      types: ['node'],
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      useUnknownInCatchVariables: true,
      verbatimModuleSyntax: true,
      skipLibCheck: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      rootDir: 'src',
      outDir: 'lib',
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`, { mode: 0o600 })
}

function isExcludedBuildPath(path: string, root: string): boolean {
  const relative = resolve(path).slice(resolve(root).length).replaceAll('\\', '/')
  return relative === '/.git' ||
    relative.startsWith('/.git/') ||
    relative === '/node_modules' ||
    relative.startsWith('/node_modules/') ||
    relative === '/dist' ||
    relative.startsWith('/dist/') ||
    relative === '/lib' ||
    relative.startsWith('/lib/')
}

function relativeFrom(root: string, path: string): string {
  return resolve(path).slice(resolve(root).length + 1).replaceAll('\\', '/')
}

function requireTarball(packages: readonly PackedPackage[], name: string): PackedPackage {
  const found = packages.find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`runtime pack is missing ${name}`)
  return found
}

function requireInstalledTarball(installed: ReadonlyMap<string, string>, name: string): string {
  const path = installed.get(name)
  if (path === undefined) throw new Error(`runtime package staging is missing ${name}`)
  return path
}

async function assertMissing(path: string, field: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`${field} already exists: ${path}`)
}

async function assertDirectory(path: string, field: string): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`${field} must be a regular directory`)
}

async function assertRegularFile(path: string, field: string): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${field} must be a regular file`)
}

function validateBuildInputs(
  sourceRoot: string,
  outputRoot: string,
  options: BuildRuntimeOptions,
): void {
  if (
    !isAbsolute(sourceRoot) ||
    !isAbsolute(outputRoot) ||
    !isAbsolute(options.videoPluginRoot) ||
    !isAbsolute(options.upstreamPatchRoot)
  ) {
    throw new TypeError('buildRuntime paths must be absolute')
  }
  if (!/^[a-f0-9]{64}$/.test(options.sourceArchiveSha256)) {
    throw new TypeError('sourceArchiveSha256 must be a lowercase SHA-256 digest')
  }
  if (!Number.isFinite(Date.parse(options.createdAt)) || new Date(options.createdAt).toISOString() !== options.createdAt) {
    throw new TypeError('createdAt must be an exact ISO timestamp')
  }
}

async function hashFileHex(path: string, algorithm: 'sha256'): Promise<string> {
  return createHash(algorithm).update(await readFile(path)).digest('hex')
}

async function hashFileBase64(path: string, algorithm: 'sha512'): Promise<string> {
  return createHash(algorithm).update(await readFile(path)).digest('base64')
}

function controlledBuildEnvironment(overrides: Readonly<NodeJS.ProcessEnv> | undefined): NodeJS.ProcessEnv {
  const allowed = new Set([
    'APPDATA', 'COMSPEC', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'PATH', 'PATHEXT',
    'PROGRAMDATA', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  ])
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) environment[key] = value
  }
  Object.assign(environment, overrides)
  for (const key of Object.keys(environment)) {
    const normalized = key.toUpperCase()
    if (
      normalized === 'NODE_OPTIONS' ||
      normalized === 'NODE_PATH' ||
      normalized.startsWith('NPM_CONFIG_') ||
      normalized.startsWith('PNPM_')
    ) delete environment[key]
  }
  environment.CI = '1'
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly captureOutput?: boolean },
): Promise<string> {
  return await new Promise<string>((resolveCommand, reject) => {
    let stdout = ''
    const invocation = resolveSpawnInvocation(command, args, process.platform, options.env)
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: options.captureOutput === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 64 * 1024) child.kill()
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolveCommand(stdout)
      else reject(new Error(`${command} exited with code ${String(code)} signal ${String(signal)}`))
    })
  })
}

export function resolveSpawnInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): { readonly command: string; readonly args: readonly string[] } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(command)) return { command, args }
  const comSpec = Object.entries(environment).find(([key, value]) => (
    key.toUpperCase() === 'COMSPEC' && value !== undefined && value.length > 0
  ))?.[1] ?? 'cmd.exe'
  return {
    command: comSpec,
    args: ['/d', '/s', '/c', command, ...args],
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

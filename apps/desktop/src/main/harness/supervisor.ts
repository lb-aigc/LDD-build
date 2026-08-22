import { randomBytes } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { delimiter, dirname, join } from 'node:path'
import { createServer } from 'node:net'
import { redactDiagnostic } from '@ldd/runtime-kit/redact'
import { terminateProcessTree } from '@ldd/runtime-kit/process-tree'
import { probeHarnessIdentity } from './identity.ts'
import type {
  HarnessHandle,
  HarnessRuntime,
  HarnessStartOptions,
} from './types.ts'

const readinessPollMs = 100
const maxDiagnosticLineLength = 64 * 1024

export class HarnessSupervisor {
  #current: HarnessHandle | null = null

  get current(): HarnessHandle | null {
    return this.#current
  }

  async start(runtime: HarnessRuntime, options: HarnessStartOptions): Promise<HarnessHandle> {
    if (this.#current !== null) {
      throw new Error('Harness is already supervised')
    }
    validateStartOptions(options)
    const port = await selectLoopbackPort(options.preferredPort)
    const nonce = randomBytes(32).toString('hex')
    const environment = createHarnessEnvironment(runtime, options, nonce)
    const child = spawn(
      runtime.nodePath,
      createHarnessArgs(runtime.dshEntryPath, options.managedPatchPath, port),
      {
        cwd: runtime.rootPath,
        detached: process.platform !== 'win32',
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    if (child.pid === undefined) {
      throw new Error('Harness process did not receive a pid')
    }

    const lifecycle = observeChildLifecycle(child)
    const credentials = collectCredentialContents(environment, options.credentialContents)
    const diagnosticDrains = [
      drainDiagnostics(child.stdout, 'stdout', options.onDiagnostic, credentials),
      drainDiagnostics(child.stderr, 'stderr', options.onDiagnostic, credentials),
    ]
    const url = `http://127.0.0.1:${port}`
    let stopPromise: Promise<void> | undefined
    const handle: HarnessHandle = {
      pid: child.pid,
      port,
      url,
      runtimeVersion: runtime.version,
      ready: Promise.resolve(),
      stop: async () => {
        stopPromise ??= this.#stopHandle(
          handle,
          child,
          lifecycle,
          diagnosticDrains,
          options,
        )
        await stopPromise
      },
    }
    this.#current = handle

    try {
      await waitForReadiness(url, nonce, child.pid, lifecycle, options.startupTimeoutMs)
      return handle
    } catch (error) {
      await handle.stop().catch(() => undefined)
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.#current?.stop()
  }

  async #stopHandle(
    handle: HarnessHandle,
    child: ChildProcess,
    lifecycle: ChildLifecycle,
    diagnosticDrains: readonly Promise<void>[],
    options: HarnessStartOptions,
  ): Promise<void> {
    await terminateProcessTree({
      pid: handle.pid,
      graceMs: options.stopGraceMs,
      forceMs: options.forceStopMs,
      isRunning: () => !lifecycle.closed,
      signalTree: async (force) => signalProcessTree(child, force),
      waitForExit: async (timeoutMs) => lifecycle.waitForClose(timeoutMs),
    })
    await lifecycle.waitForClose(options.forceStopMs)
    await Promise.all(diagnosticDrains)
    if (this.#current === handle) {
      this.#current = null
    }
  }
}

export function createHarnessArgs(
  dshEntryPath: string,
  managedPatchPath: string,
  port: number,
): readonly string[] {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('Harness port must be an integer between 1 and 65535')
  }
  return [
    dshEntryPath,
    'web',
    // Launcher-owned flags must precede the first web-app flag because the
    // Harness CLI deliberately passes every later argument through.
    '--patch',
    managedPatchPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--no-open',
  ]
}

interface ChildLifecycle {
  readonly closed: boolean
  readonly spawnError: Error | null
  readonly exitCode: number | null
  readonly exitSignal: NodeJS.Signals | null
  waitForClose(timeoutMs: number): Promise<boolean>
}

function observeChildLifecycle(child: ChildProcess): ChildLifecycle {
  let closed = false
  let spawnError: Error | null = null
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null
  let resolveClose: (() => void) | undefined
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve
  })
  child.once('error', (error) => {
    spawnError = error
  })
  child.once('close', (code, signal) => {
    closed = true
    exitCode = code
    exitSignal = signal
    resolveClose?.()
  })
  return {
    get closed() {
      return closed
    },
    get spawnError() {
      return spawnError
    },
    get exitCode() {
      return exitCode
    },
    get exitSignal() {
      return exitSignal
    },
    async waitForClose(timeoutMs) {
      if (closed) return true
      return await new Promise<boolean>((resolveWait) => {
        const timer = setTimeout(() => resolveWait(false), timeoutMs)
        void closePromise.then(() => {
          clearTimeout(timer)
          resolveWait(true)
        })
      })
    },
  }
}

async function waitForReadiness(
  url: string,
  nonce: string,
  pid: number,
  lifecycle: ChildLifecycle,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    if (lifecycle.spawnError !== null) {
      throw lifecycle.spawnError
    }
    if (lifecycle.closed) {
      throw new Error(
        `Harness exited before readiness (code=${String(lifecycle.exitCode)}, signal=${String(lifecycle.exitSignal)})`,
      )
    }
    try {
      const root = await fetch(url, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(1_000),
      })
      if (!root.ok) {
        throw new Error(`Harness root returned HTTP ${root.status}`)
      }
      await root.body?.cancel()
      await probeHarnessIdentity(url, nonce, { expectedPid: pid, timeoutMs: 1_000 })
      return
    } catch (error) {
      lastError = error
    }
    await delay(readinessPollMs)
  }
  const reason = lastError instanceof Error ? lastError.message : 'unknown readiness failure'
  throw new Error(`Harness readiness timed out: ${reason}`)
}

async function selectLoopbackPort(preferredPort: number): Promise<number> {
  if (await canBindLoopback(preferredPort)) {
    return preferredPort
  }
  return await reserveEphemeralPort()
}

async function canBindLoopback(port: number): Promise<boolean> {
  const server = createServer()
  server.unref()
  return await new Promise((resolveAvailable) => {
    server.once('error', () => resolveAvailable(false))
    server.listen({ exclusive: true, host: '127.0.0.1', port }, () => {
      server.close((error) => resolveAvailable(error === undefined))
    })
  })
}

async function reserveEphemeralPort(): Promise<number> {
  const server = createServer()
  server.unref()
  return await new Promise((resolvePort, reject) => {
    server.once('error', reject)
    server.listen({ exclusive: true, host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('OS did not allocate a loopback port'))
        return
      }
      server.close((error) => {
        if (error === undefined) resolvePort(address.port)
        else reject(error)
      })
    })
  })
}

function createHarnessEnvironment(
  runtime: HarnessRuntime,
  options: HarnessStartOptions,
  nonce: string,
): NodeJS.ProcessEnv {
  const controlledPath = [
    dirname(runtime.nodePath),
    dirname(runtime.pnpmPath),
    dirname(runtime.ffmpegPath),
    systemDirectory(),
  ].filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.environment,
    DSH_HOME: options.dshHome,
    LDD_RUNTIME_VERSION: runtime.version,
    LDD_FFMPEG_PATH: runtime.ffmpegPath,
    LDD_FFPROBE_PATH: runtime.ffprobePath,
    LDD_IMAGE_MODE: options.imageMode,
    LDD_IDENTITY_NONCE: nonce,
    PATH: controlledPath.join(delimiter),
  }
  delete environment.ELECTRON_RUN_AS_NODE
  return environment
}

function systemDirectory(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
  return systemRoot === undefined ? '' : join(systemRoot, 'System32')
}

async function drainDiagnostics(
  stream: NodeJS.ReadableStream | null,
  source: string,
  consume: (line: string) => void,
  credentialContents: readonly string[],
): Promise<void> {
  if (stream === null) return
  let pending = ''
  try {
    for await (const chunk of stream) {
      pending += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        publishDiagnostic(source, line, consume, credentialContents)
      }
      if (pending.length > maxDiagnosticLineLength) {
        publishDiagnostic(
          source,
          `${pending.slice(0, maxDiagnosticLineLength)}…[truncated]`,
          consume,
          credentialContents,
        )
        pending = ''
      }
    }
    if (pending.length > 0) {
      publishDiagnostic(source, pending, consume, credentialContents)
    }
  } catch (error) {
    publishDiagnostic(
      source,
      `diagnostic stream failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      consume,
      credentialContents,
    )
  }
}

function publishDiagnostic(
  source: string,
  line: string,
  consume: (line: string) => void,
  credentialContents: readonly string[],
): void {
  try {
    consume(redactDiagnostic(`[Harness ${source}] ${line}`, credentialContents))
  } catch {
    // Diagnostics are observational and cannot own process lifecycle.
  }
}

function collectCredentialContents(
  environment: NodeJS.ProcessEnv,
  explicit: readonly string[] | undefined,
): readonly string[] {
  const secrets = [...(explicit ?? [])]
  for (const [key, value] of Object.entries(environment)) {
    if (
      value !== undefined &&
      /(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|PASSWORD)/iu.test(key)
    ) {
      secrets.push(value)
    }
  }
  return secrets
}

async function signalProcessTree(child: ChildProcess, force: boolean): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    await execute(executable, [
      '/PID',
      String(pid),
      '/T',
      ...(force ? ['/F'] : []),
    ])
    return
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ESRCH') {
      throw error
    }
  }
}

async function execute(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveExecution, reject) => {
    execFile(command, [...args], { windowsHide: true }, (error) => {
      if (error === null) resolveExecution()
      else reject(error)
    })
  })
}

function validateStartOptions(options: HarnessStartOptions): void {
  if (!Number.isSafeInteger(options.preferredPort) || options.preferredPort < 1 || options.preferredPort > 65_535) {
    throw new TypeError('preferredPort must be between 1 and 65535')
  }
  for (const [field, value] of [
    ['startupTimeoutMs', options.startupTimeoutMs],
    ['stopGraceMs', options.stopGraceMs],
    ['forceStopMs', options.forceStopMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${field} must be a non-negative integer`)
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

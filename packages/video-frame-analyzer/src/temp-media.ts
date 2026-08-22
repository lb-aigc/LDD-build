import { createHash, randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const markerFilename = '.ldd-video-task.json'

export interface ManagedMediaChild {
  stop(): Promise<void>
  waitForExit(): Promise<void>
}

export interface TempMediaContext {
  readonly path: string
  readonly markerPath: string
  readonly signal: AbortSignal
  trackChild(child: ManagedMediaChild): void
}

export interface TempMediaOptions {
  readonly cacheRoot: string
  readonly taskId: string
  readonly signal?: AbortSignal
}

interface OwnershipMarker {
  readonly schemaVersion: 1
  readonly nonce: string
  readonly taskPath: string
}

export async function withTempMedia<T>(
  options: TempMediaOptions,
  task: (context: TempMediaContext) => Promise<T>,
): Promise<T> {
  const cacheRoot = await prepareCacheRoot(options.cacheRoot)
  const prefix = join(cacheRoot, `task-${taskIdentity(options.taskId)}-`)
  const taskPath = await mkdtemp(prefix)
  await chmod(taskPath, 0o700)
  const nonce = randomBytes(32).toString('hex')
  const markerPath = join(taskPath, markerFilename)
  const marker: OwnershipMarker = { schemaVersion: 1, nonce, taskPath }
  await writeFile(markerPath, `${JSON.stringify(marker)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })

  const abortController = new AbortController()
  const relayAbort = () => abortController.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', relayAbort, { once: true })
  if (options.signal?.aborted === true) relayAbort()
  const children = new Set<ManagedMediaChild>()
  let acceptingChildren = true
  const context: TempMediaContext = {
    path: taskPath,
    markerPath,
    signal: abortController.signal,
    trackChild(child) {
      if (!acceptingChildren || abortController.signal.aborted) {
        throw new Error('cannot track a media child after cleanup has started')
      }
      children.add(child)
    },
  }

  let result: T | undefined
  let primaryError: unknown
  try {
    result = await task(context)
  } catch (error) {
    primaryError = error
  } finally {
    acceptingChildren = false
    abortController.abort(new Error('video media task is cleaning up'))
    options.signal?.removeEventListener('abort', relayAbort)
  }

  const cleanupErrors: unknown[] = []
  for (const child of children) {
    await child.stop().catch((error: unknown) => cleanupErrors.push(error))
  }
  for (const child of children) {
    await child.waitForExit().catch((error: unknown) => cleanupErrors.push(error))
  }
  if (cleanupErrors.length === 0) {
    await removeOwnedTaskDirectory(cacheRoot, taskPath, marker).catch((error: unknown) =>
      cleanupErrors.push(error),
    )
  }

  const errors = [...(primaryError === undefined ? [] : [primaryError]), ...cleanupErrors]
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'video task and cleanup failed')
  return result as T
}

async function prepareCacheRoot(cacheRoot: string): Promise<string> {
  if (!isAbsolute(cacheRoot)) throw new TypeError('video cache root must be absolute')
  await mkdir(cacheRoot, { mode: 0o700, recursive: true })
  const metadata = await lstat(cacheRoot)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('video cache root is link-shaped or not a directory')
  }
  return await realpath(cacheRoot)
}

async function removeOwnedTaskDirectory(
  cacheRoot: string,
  taskPath: string,
  expected: OwnershipMarker,
): Promise<void> {
  const metadata = await lstat(taskPath)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('temporary media directory lost its ownership shape')
  }
  const realTaskPath = await realpath(taskPath)
  if (!isInside(cacheRoot, realTaskPath)) {
    throw new Error('temporary media directory escaped its cache root')
  }
  const markerPath = join(realTaskPath, markerFilename)
  let serialized: string
  try {
    const markerMetadata = await lstat(markerPath)
    if (markerMetadata.isSymbolicLink() || !markerMetadata.isFile()) {
      throw new Error('temporary media ownership marker has an invalid shape')
    }
    serialized = await readFile(markerPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error('temporary media ownership marker is missing')
    }
    throw error
  }
  const actual = parseMarker(serialized)
  if (
    actual.schemaVersion !== expected.schemaVersion ||
    actual.nonce !== expected.nonce ||
    resolve(actual.taskPath) !== resolve(expected.taskPath) ||
    resolve(actual.taskPath) !== resolve(realTaskPath)
  ) {
    throw new Error('temporary media ownership marker does not match the task')
  }
  await rm(realTaskPath, { recursive: true, force: false, maxRetries: 2 })
}

function parseMarker(serialized: string): OwnershipMarker {
  const value = JSON.parse(serialized) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('temporary media ownership marker is invalid')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.nonce !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.nonce) ||
    typeof record.taskPath !== 'string' ||
    !isAbsolute(record.taskPath)
  ) {
    throw new Error('temporary media ownership marker is invalid')
  }
  return { schemaVersion: 1, nonce: record.nonce, taskPath: record.taskPath }
}

function taskIdentity(taskId: string): string {
  if (taskId.length === 0 || taskId.length > 1_024) {
    throw new TypeError('video task identity is invalid')
  }
  return createHash('sha256').update(taskId).digest('hex').slice(0, 16)
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

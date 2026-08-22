import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

const ignorableDirectorySyncCodes = new Set([
  'EACCES',
  'EBADF',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
])

export async function writeAtomicJson(targetPath: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2)
  if (json === undefined) {
    throw new TypeError('value cannot be represented as JSON')
  }
  await writeAtomicText(targetPath, `${json}\n`)
}

export async function writeAtomicText(targetPath: string, serialized: string): Promise<void> {
  const parentPath = dirname(targetPath)
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(parentPath, { recursive: true })

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(serialized, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, targetPath)
    await syncDirectory(parentPath)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temporaryPath).catch((unlinkError: unknown) => {
      if (!isNodeError(unlinkError) || unlinkError.code !== 'ENOENT') {
        throw unlinkError
      }
    })
    throw error
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>> | undefined
  try {
    directory = await open(directoryPath, 'r')
    await directory.sync()
  } catch (error) {
    if (!isNodeError(error) || !ignorableDirectorySyncCodes.has(error.code ?? '')) {
      throw error
    }
  } finally {
    await directory?.close().catch(() => undefined)
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

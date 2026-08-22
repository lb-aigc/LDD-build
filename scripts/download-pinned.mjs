import { createHash } from 'node:crypto'
import { open, rm } from 'node:fs/promises'

export async function downloadPinned(urls, expectedSha256, destination, maxBytes, options = {}) {
  if (!Array.isArray(urls) || urls.length === 0) throw new TypeError('download requires at least one source URL')
  const attemptsPerSource = options.attemptsPerSource ?? 3
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const sleepImpl = options.sleepImpl ?? sleep
  const failures = []

  for (const url of urls) {
    for (let attempt = 1; attempt <= attemptsPerSource; attempt += 1) {
      await rm(destination, { force: true })
      try {
        await downloadOnce(url, expectedSha256, destination, maxBytes, fetchImpl)
        return
      } catch (error) {
        await rm(destination, { force: true })
        failures.push(`${url} attempt ${String(attempt)}: ${errorMessage(error)}`)
        if (attempt >= attemptsPerSource || !isTransientDownloadFailure(error)) break
        await sleepImpl(1000 * (2 ** (attempt - 1)))
      }
    }
  }

  throw new Error(`download failed from all pinned sources:\n${failures.join('\n')}`)
}

async function downloadOnce(url, expectedSha256, destination, maxBytes, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok || response.body === null) throw new DownloadHttpError(response.status, url)
  const output = await open(destination, 'wx', 0o600)
  const hash = createHash('sha256')
  let size = 0
  let position = 0
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > maxBytes) throw new Error(`download exceeds size limit: ${url}`)
      hash.update(bytes)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesWritten } = await output.write(bytes, offset, bytes.length - offset, position)
        if (bytesWritten === 0) throw new Error('download write made no progress')
        offset += bytesWritten
        position += bytesWritten
      }
    }
    await output.sync()
  } finally {
    await output.close()
  }
  if (hash.digest('hex') !== expectedSha256) throw new Error(`download digest mismatch: ${url}`)
}

class DownloadHttpError extends Error {
  constructor(status, url) {
    super(`download returned HTTP ${String(status)}: ${url}`)
    this.status = status
  }
}

function isTransientDownloadFailure(error) {
  if (error instanceof DownloadHttpError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500
  }
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function sleep(milliseconds) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

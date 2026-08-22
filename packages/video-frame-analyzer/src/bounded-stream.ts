export interface BoundedStreamOptions {
  readonly maxBytes: number
  readonly maxChunks: number
}

export async function* boundedVisionStream<T>(
  source: AsyncIterable<T>,
  options: BoundedStreamOptions,
): AsyncGenerator<T> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new TypeError('vision response byte limit must be a positive integer')
  }
  if (!Number.isSafeInteger(options.maxChunks) || options.maxChunks <= 0) {
    throw new TypeError('vision response chunk limit must be a positive integer')
  }
  let bytes = 0
  let chunks = 0
  for await (const chunk of source) {
    chunks += 1
    if (chunks > options.maxChunks) throw new Error('vision stream exceeded the chunk limit')
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(chunk)
    } catch {
      throw new Error('vision stream contained a non-serializable chunk')
    }
    if (serialized === undefined) throw new Error('vision stream contained an undefined chunk')
    bytes += Buffer.byteLength(serialized, 'utf8')
    if (bytes > options.maxBytes) throw new Error('vision stream exceeded the response limit')
    yield chunk
  }
}

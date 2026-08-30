/**
 * Image attachment seam: turn a generated image URL (http(s) or data URI) into
 * a durable harness attachment so the image renders IN the conversation as an
 * `image` content block, instead of a JSON blob the user must fetch by hand.
 *
 * The harness `attachments` service (`ctx.attachments`, provided by
 * `@deepseek-ai/dsh-attachment`) validates and durably stores image bytes and
 * returns an `ImageAttachmentRef`. Its `attachmentId` is a nominal brand
 * (`Branded<'AttachmentId'>`), which is a plain string at runtime. This plugin
 * shims the types locally (the brand is compile-time-only) so it does NOT need
 * a `@deepseek-ai/dsh-attachment` dependency edge — adding one would re-trigger
 * the pnpm-lockfile git-fetch deadlock (see the ldd-desktop-build skill). The
 * runtime objects are byte-identical to what the reference `read_image` tool
 * produces.
 */

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Serializable attachment metadata carried inside a tool's canonical value. */
export interface ImageMeta {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/** Minimal surface of the harness attachment service this plugin consumes. */
export interface AttachmentStoreLike {
  saveImage(input: { data: Uint8Array; mediaType: ImageMediaType; name?: string }): Promise<ImageMeta>
  /** Read back a stored image's bytes by its durable reference (used to turn a
   *  user-uploaded image into a reference image for image-to-image). */
  readImage(ref: ImageMeta): Promise<{ data: Uint8Array }>
}

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const CONTENT_TYPE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
}

/** Guess a media type from a URL path suffix, or undefined. */
export function mediaTypeFromUrl(url: string): ImageMediaType | undefined {
  const path = url.split('?')[0] ?? url
  const dot = path.lastIndexOf('.')
  if (dot === -1) return undefined
  return EXTENSION_MEDIA_TYPES[path.slice(dot).toLowerCase()]
}

/** Map a `Content-Type` header value (params stripped) to a media type. */
export function mediaTypeFromContentType(contentType: string): ImageMediaType | undefined {
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return CONTENT_TYPE_MEDIA_TYPES[base]
}

/** Parse a `data:<mediaType>;base64,<data>` URI into bytes + media type. */
export function parseDataUri(uri: string): { data: Uint8Array; mediaType: ImageMediaType } | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(uri)
  if (match === null) return undefined
  const mediaType = match[1] as ImageMediaType
  const base64 = match[2] ?? ''
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return { data: bytes, mediaType }
  } catch {
    return undefined
  }
}

/** Delay that honours an abort signal. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Fetch an http(s) URL into image bytes. Returns undefined on any failure so a
 * provider that returns a placeholder (mock) or an expired URL degrades to a
 * plain-text result instead of failing the whole generation.
 *
 * The download is retried (3 attempts, exponential backoff) because generated
 * image CDNs (e.g. playjoy3d behind legnext) are reached over flaky network
 * paths — a single transient reset/timeout otherwise drops the image to a
 * text-only URL. Non-retryable failures (HTTP 4xx, abort) fail fast.
 */
async function fetchBytes(url: string, signal: AbortSignal): Promise<{ data: Uint8Array; mediaType: ImageMediaType } | undefined> {
  const MAX_ATTEMPTS = 3
  let lastError: string = ''
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) return undefined
    let response: Response
    try {
      response = await fetch(url, { signal })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (signal.aborted) return undefined
      if (attempt < MAX_ATTEMPTS - 1) { await sleep(600 * (attempt + 1), signal); continue }
      break
    }
    if (!response.ok) {
      // 4xx is permanent (wrong/expired URL) — retrying cannot fix it.
      if (response.status >= 400 && response.status < 500) return undefined
      lastError = `HTTP ${response.status}`
      if (attempt < MAX_ATTEMPTS - 1) { await sleep(600 * (attempt + 1), signal); continue }
      break
    }
    const headerType = response.headers.get('content-type')
    const mediaType = (headerType !== null ? mediaTypeFromContentType(headerType) : undefined) ?? mediaTypeFromUrl(url)
    if (mediaType === undefined) return undefined
    try {
      const buffer = await response.arrayBuffer()
      return { data: new Uint8Array(buffer), mediaType }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (signal.aborted) return undefined
      if (attempt < MAX_ATTEMPTS - 1) { await sleep(600 * (attempt + 1), signal); continue }
    }
  }
  console.error(`[ldd-generate] 图片下载失败（已重试 ${MAX_ATTEMPTS} 次）：${url} — ${lastError}`)
  return undefined
}

/**
 * Download a generated image URL and durably store it as an attachment.
 * @returns the serializable attachment metadata, or undefined when the URL is
 *   a placeholder / non-image / un-fetchable / rejected by the attachment store
 *   (in which case the caller falls back to a text-only result).
 */
export async function attachImageFromUrl(
  url: string,
  store: AttachmentStoreLike,
  signal: AbortSignal,
): Promise<ImageMeta | undefined> {
  let bytes: Uint8Array
  let mediaType: ImageMediaType

  if (url.startsWith('data:')) {
    const parsed = parseDataUri(url)
    if (parsed === undefined) return undefined
    bytes = parsed.data
    mediaType = parsed.mediaType
  } else if (url.startsWith('http://') || url.startsWith('https://')) {
    const fetched = await fetchBytes(url, signal)
    if (fetched === undefined) return undefined
    bytes = fetched.data
    mediaType = fetched.mediaType
  } else {
    // Placeholder schemes (e.g. mock-image://) have no bytes to store.
    return undefined
  }

  // KIE PNGs carry an `hf-job-id` text comment that trips sharp's metadata
  // check and forces a lossy JPEG re-encode. Strip text chunks so a lossless
  // PNG passes through byte-identically and downloads stay lossless.
  if (mediaType === 'image/png') {
    bytes = stripPngTextChunks(bytes)
  }

  try {
    const ref = await store.saveImage({ data: bytes, mediaType })
    return {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...ref.name === undefined ? {} : { name: ref.name },
    }
  } catch {
    // Rejected by the attachment store (oversized / wrong type / storage error)
    // — degrade to text rather than fail the generation.
    return undefined
  }
}

/**
 * Build the content block an attached image renders as. The `attachment` field
 * is asserted because the harness `ImageBlock.attachment` carries the nominal
 * `ImageAttachmentRef` brand this plugin intentionally does not import; at
 * runtime the field is the identical plain object.
 */
export function imageBlockOf(meta: ImageMeta): { type: 'image'; attachment: ImageMeta } {
  return { type: 'image', attachment: meta }
}

/**
 * Strip text metadata chunks (tEXt / iTXt / zTXt) from a PNG byte stream. KIE
 * PNGs carry an `hf-job-id` tEXt comment that makes sharp's normalization
 * classify the image as metadata-bearing, which re-encodes a lossless PNG into
 * a lossy JPEG for storage. Removing only the text chunks lets the PNG pass
 * through byte-identically (lossless), while pixel data (IDAT) and C2PA
 * provenance (caBX) are preserved untouched. Non-PNG or malformed input is
 * returned unchanged.
 */
export function stripPngTextChunks(data: Uint8Array): Uint8Array {
  if (data.length < 8) return data
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return data
  const out: number[] = []
  for (let i = 0; i < 8; i++) out.push(data[i]!)
  let offset = 8
  while (offset + 8 <= data.length) {
    const length = (((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0)
    const chunkSize = 12 + length
    if (offset + chunkSize > data.length) return data
    const t0 = data[offset + 4] ?? 0
    const t1 = data[offset + 5] ?? 0
    const t2 = data[offset + 6] ?? 0
    const t3 = data[offset + 7] ?? 0
    const isTextChunk =
      (t0 === 0x74 && t1 === 0x45 && t2 === 0x58 && t3 === 0x74) // tEXt
      || (t0 === 0x69 && t1 === 0x54 && t2 === 0x58 && t3 === 0x74) // iTXt
      || (t0 === 0x7a && t1 === 0x54 && t2 === 0x58 && t3 === 0x74) // zTXt
    if (!isTextChunk) {
      for (let i = 0; i < chunkSize; i++) out.push(data[offset + i]!)
    }
    offset += chunkSize
  }
  return new Uint8Array(out)
}

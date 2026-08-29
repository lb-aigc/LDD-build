/**
 * Shared reference-image resolution for image-to-image providers.
 *
 * The `generate_image` tool accepts reference images as http(s) URLs or
 * `data:` URIs (see `GenerateImageRequest.inputImages`). Each provider needs a
 * different wire form — multipart bytes (OpenAI `images/edits`), base64
 * `inlineData` (Gemini), base64 `image` field (Volcengine Seedream), or a
 * public URL (KIE `input_urls`) — so this module resolves the common inputs
 * once and lets adapters pick the shape they need.
 */
import type { ImageMediaType } from '../attach.ts'
import { mediaTypeFromContentType, mediaTypeFromUrl, parseDataUri } from '../attach.ts'

/** Reference image bytes plus a concrete media type. */
export interface ImageBytes {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
}

/** Reference image as a base64 payload plus its media type. */
export interface ImageBase64 {
  readonly base64: string
  readonly mediaType: ImageMediaType
}

/**
 * Resolve a reference image into bytes. Accepts a `data:` URI (decoded
 * in-process) or an http(s) URL (fetched with bounded retry). Anything else is
 * a model-visible error so a stale tool call fails informatively.
 */
export async function resolveImageBytes(input: string, signal: AbortSignal): Promise<ImageBytes> {
  if (input.startsWith('data:')) {
    const parsed = parseDataUri(input)
    if (parsed === undefined) throw new Error(`参考图 data URI 无法解析（需 base64 图片）`)
    return { data: parsed.data, mediaType: parsed.mediaType }
  }
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const fetched = await fetchImageBytes(input, signal)
    if (fetched === undefined) throw new Error(`参考图下载失败：${input}`)
    return fetched
  }
  throw new Error(`参考图必须是 http(s) URL 或 data URI（收到 ${input.slice(0, 40)}…）`)
}

/** Resolve a reference image into base64 (for Gemini inlineData / Volcengine). */
export async function resolveImageBase64(input: string, signal: AbortSignal): Promise<ImageBase64> {
  const { data, mediaType } = await resolveImageBytes(input, signal)
  return { base64: bytesToBase64(data), mediaType }
}

/**
 * Require a public http(s) URL, for providers whose i2i wire protocol takes a
 * URL directly (KIE `input_urls`) and cannot accept a local `data:` URI.
 */
export function requirePublicImageUrl(input: string): string {
  if (input.startsWith('http://') || input.startsWith('https://')) return input
  throw new Error(`该模型的图生图需要公网可访问的图片 URL（不支持本地 data URI）：${input.slice(0, 40)}…`)
}

async function fetchImageBytes(
  url: string,
  signal: AbortSignal,
): Promise<ImageBytes | undefined> {
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
  console.error(`[ldd-generate] 参考图下载失败（已重试 ${MAX_ATTEMPTS} 次）：${url} — ${lastError}`)
  return undefined
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

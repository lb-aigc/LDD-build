/**
 * Collect user-uploaded images from the live session so `generate_image` can use
 * them as image-to-image reference inputs.
 *
 * When the agent passes `@uploaded` in `inputImages`, the tool resolves it by
 * walking the CURRENT session's event log backward to the most recent
 * `user/message`, extracting its `image` content blocks, and reading their bytes
 * back through the attachment store. The result is a list of `data:` URIs that
 * feed the normal reference-image path (KIE uploads them to a public URL; every
 * other protocol accepts the data URI directly).
 *
 * All harness types are shimmed locally (no `@deepseek-ai/dsh-agent` /
 * `@deepseek-ai/dsh-session` import) so the plugin keeps its dependency edge
 * minimal — the runtime objects are byte-compatible with the harness shapes.
 */
import type { AttachmentStoreLike, ImageMediaType, ImageMeta } from './attach.ts'

/** One image-bearing content block from a user message. */
export interface UploadedContentBlockLike {
  type?: string
  attachment?: ImageMeta
}

/** One session event; only `user/message` carries a `content` array here. */
export interface UploadedEventLike {
  type: string
  data?: {
    content?: UploadedContentBlockLike[]
  }
}

/** The slice of a harness Agent the collector reads (its live session). */
export interface UploadedAgentLike {
  session?: UploadedSessionLike
}

/** The slice of a harness Session the collector reads (the append-only event log). */
export interface UploadedSessionLike {
  events: readonly UploadedEventLike[]
}

/**
 * Resolve the agent's most recently uploaded images into `data:` URIs.
 *
 * The event log is walked FORWARD (oldest → newest), collecting EVERY
 * user-uploaded image, then the most recent `maxImages` are kept. This spans
 * MULTIPLE user messages — so an image uploaded in an earlier message (e.g.
 * "角色三视图" sent first, "场景图" sent next) is NOT dropped, which was the
 * old "only the latest user/message" behaviour's bug. Upload order is preserved
 * so a prompt's "第一张/第二张" references stay stable.
 *
 * @param session - the agent's live session (undefined outside a session scope).
 * @param store - the attachment store (undefined when unmounted); without it no
 *   image can be read back and the result is empty.
 * @param signal - cancellation forwarded to the read.
 * @param maxImages - upper bound on returned references (KIE models accept
 *   8-16 reference images; 8 is a safe floor that matches the smallest cap).
 */
export async function collectUploadedImages(
  session: UploadedSessionLike | undefined,
  store: AttachmentStoreLike | undefined,
  signal: AbortSignal,
  maxImages = 8,
): Promise<string[]> {
  if (session === undefined || store === undefined) return []
  const collected: string[] = []
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    const content = event.data?.content ?? []
    for (const block of content) {
      if (block.type !== 'image' || block.attachment === undefined) continue
      signal.throwIfAborted()
      try {
        const stored = await store.readImage(block.attachment)
        collected.push(dataUriOf(block.attachment.mediaType, stored.data))
      } catch {
        // An unreadable attachment is skipped; the rest still resolve.
      }
    }
  }
  return collected.length > maxImages ? collected.slice(-maxImages) : collected
}

function dataUriOf(mediaType: ImageMediaType, data: Uint8Array): string {
  return `data:${mediaType};base64,${bytesToBase64(data)}`
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

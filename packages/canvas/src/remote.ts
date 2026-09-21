/**
 * @ldd/dsh-canvas — Canvas write-back Remote service (typert remote).
 *
 * The host half of the canvas's bidirectional-editing path. The agent mutates
 * the canvas through `canvas_*` tools; this service exposes the SAME mutations
 * as typert `@Remote` verbs so the CLIENT can call them directly (drag / link /
 * edit / delete) and the change lands as a durable `canvas/state` session event
 * — zero agent round-trip.
 *
 * Every verb takes the owning session's `SessionId` as its FIRST parameter —
 * the same direct (non-lookup) shape the harness `session-controller` uses
 * (`prompt({ sessionId })`, `commands.execute(sessionId, …)`). The client calls
 * `ctx.remote.canvas.addNode(sessionId, request)` with no scope machinery; the
 * host resolves the live `Agent` through `ctx.agents.get(sessionId)` and writes
 * back through `agent.session.append` — the exact seam the `canvas_*` tools
 * already use, so agent and user edits share one durable mirror.
 */
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

import { addEdge, addNode, emptyCanvas, removeNode, updateNode } from './model.ts'
import type { CanvasNode, CanvasState } from './types.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasSaveAssetRequest, CanvasSaveAssetValue, CanvasUpdateNodeRequest } from './types.ts'

/** Structural face of `ctx.attachments` (dsh-attachment). Shims the two write
 *  entry points so this package does NOT add a dsh-attachment dependency edge
 *  (that would re-trigger the pnpm-lockfile git-fetch deadlock). The runtime
 *  object is the real AttachmentStore, byte-identical. */
interface AttachmentStoreLike {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<{
    attachmentId: string
    width: number
    height: number
  }>
  saveFile(input: { data: Uint8Array; name?: string }): Promise<{ attachmentId: string }>
}

/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas(events: readonly SessionEvent[]): CanvasState {
  let state = emptyCanvas()
  for (const event of events) {
    if (event.type === 'canvas/state') state = event.data.state
  }
  return state
}

export class CanvasService extends TypertRemoteService {
  static inject = ['attachments']

  constructor(ctx: Context) {
    super(ctx, 'canvas')
  }

  /** Resolve the live Session owning a session id (the canvas write-back seam). */
  private sessionOf(sessionId: SessionId): Session {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error(`canvas: 会话不可用 (${String(sessionId)})`)
    return session
  }

  /** Read the whole canvas. */
  @Remote('inspect')
  inspect(sessionId: SessionId): CanvasState {
    return foldCanvas(this.sessionOf(sessionId).snapshotEvents())
  }

  /** Add a node; returns the full new canvas (the client re-renders from it). */
  @Remote('addNode')
  addNode(sessionId: SessionId, request: CanvasAddNodeRequest): CanvasState {
    const session = this.sessionOf(sessionId)
    const before = foldCanvas(session.snapshotEvents())
    const auto = before.nodes.length
    const { state: next } = addNode(before, {
      ...(request.id === undefined ? {} : { id: request.id }),
      kind: request.kind,
      label: request.label,
      x: typeof request.x === 'number' ? request.x : (auto % 4) * 220,
      y: typeof request.y === 'number' ? request.y : Math.floor(auto / 4) * 180,
      ...(request.content === undefined ? {} : { content: request.content }),
      ...(request.url === undefined ? {} : { url: request.url }),
      ...(request.meta === undefined ? {} : { meta: request.meta }),
    })
    session.append('canvas/state', { state: next })
    return next
  }

  /** Remove a node (and its touching edges); returns the full new canvas. */
  @Remote('removeNode')
  removeNode(sessionId: SessionId, nodeId: string): CanvasState {
    const session = this.sessionOf(sessionId)
    const before = foldCanvas(session.snapshotEvents())
    const next = removeNode(before, nodeId)
    session.append('canvas/state', { state: next })
    return next
  }

  /** Patch one node's mutable fields; returns the full new canvas. */
  @Remote('updateNode')
  updateNode(sessionId: SessionId, nodeId: string, patch: CanvasUpdateNodeRequest): CanvasState {
    const session = this.sessionOf(sessionId)
    const before = foldCanvas(session.snapshotEvents())
    const next = updateNode(before, nodeId, {
      ...(patch.label === undefined ? {} : { label: patch.label }),
      ...(patch.x === undefined ? {} : { x: patch.x }),
      ...(patch.y === undefined ? {} : { y: patch.y }),
      ...(patch.content === undefined ? {} : { content: patch.content }),
      ...(patch.meta === undefined ? {} : { meta: patch.meta }),
    })
    session.append('canvas/state', { state: next })
    return next
  }

  /** Move a node (position-only convenience; returns the full new canvas). */
  @Remote('moveNode')
  moveNode(sessionId: SessionId, nodeId: string, x: number, y: number): CanvasState {
    const session = this.sessionOf(sessionId)
    const before = foldCanvas(session.snapshotEvents())
    const next = updateNode(before, nodeId, { x, y })
    session.append('canvas/state', { state: next })
    return next
  }

  /** Link two nodes; returns the full new canvas. */
  @Remote('link')
  link(sessionId: SessionId, request: CanvasLinkRequest): CanvasState {
    const session = this.sessionOf(sessionId)
    const before = foldCanvas(session.snapshotEvents())
    const { state: next } = addEdge(before, {
      source: request.source,
      target: request.target,
      ...(request.label === undefined ? {} : { label: request.label }),
    })
    session.append('canvas/state', { state: next })
    return next
  }

  /** Store one user-uploaded asset durably (image → normalized via `saveImage`,
   *  video/audio → verbatim via `saveFile`); returns its content-addressed
   *  attachment id (+ normalized image size). The client stores the id as the
   *  node's `url` so `loadImage` can read it back. */
  @Remote('saveAsset')
  async saveAsset(sessionId: SessionId, request: CanvasSaveAssetRequest): Promise<CanvasSaveAssetValue> {
    this.sessionOf(sessionId)
    const attachments = (this.ctx as unknown as { attachments?: AttachmentStoreLike }).attachments
    if (attachments === undefined) throw new Error('canvas: 附件存储不可用')
    const binary = atob(request.dataBase64)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
    if (request.kind === 'image') {
      if (request.mediaType === undefined) throw new Error('canvas: 图片上传缺少媒体类型')
      const ref = await attachments.saveImage({ data, mediaType: request.mediaType, name: request.name })
      return { attachmentId: ref.attachmentId, width: ref.width, height: ref.height }
    }
    const ref = await attachments.saveFile({ data, name: request.name })
    return { attachmentId: ref.attachmentId }
  }
}

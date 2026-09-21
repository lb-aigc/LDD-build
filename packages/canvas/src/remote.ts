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
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasUpdateNodeRequest } from './types.ts'

/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas(events: readonly SessionEvent[]): CanvasState {
  let state = emptyCanvas()
  for (const event of events) {
    if (event.type === 'canvas/state') state = event.data.state
  }
  return state
}

export class CanvasService extends TypertRemoteService {
  static inject = []

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
}

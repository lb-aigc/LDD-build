/**
 * @ldd/dsh-canvas — Canvas write-back Remote service (typert remote).
 *
 * The host half of the canvas's bidirectional-editing path. The agent mutates
 * the canvas through `canvas_*` tools; this service exposes the SAME mutations
 * as typert `@Remote` verbs so the CLIENT can call them directly (drag / link /
 * edit / delete) and the change lands as a durable `canvas/state` session event
 * — zero agent round-trip.
 *
 * Each verb takes the owning `Agent` as its FIRST parameter. The typert
 * generator recognizes it as a lookup (the `agent: TypertLookup<Agent,
 * SessionId>` entry in `@deepseek-ai/dsh-agent/types`) and the harness
 * `agents` service resolves the wire `agentId` back to the live `Agent`; the
 * verb then reads the current canvas out of `agent.session.snapshotEvents()`,
 * applies a pure `model.ts` transition, and commits a whole-value
 * `canvas/state` event via `session.append` — the exact seam the `canvas_*`
 * tools already use, so agent and user edits share one durable mirror.
 */
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

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

  /** Read the whole canvas. */
  @Remote('inspect')
  inspect(agent: Agent): CanvasState {
    return foldCanvas(agent.session.snapshotEvents())
  }

  /** Add a node; returns the full new canvas (the client re-renders from it). */
  @Remote('addNode')
  addNode(agent: Agent, request: CanvasAddNodeRequest): CanvasState {
    const session = agent.session
    const before = foldCanvas(session.snapshotEvents())
    const auto = before.nodes.length
    const { state: next } = addNode(before, {
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
  removeNode(agent: Agent, nodeId: string): CanvasState {
    const session = agent.session
    const before = foldCanvas(session.snapshotEvents())
    const next = removeNode(before, nodeId)
    session.append('canvas/state', { state: next })
    return next
  }

  /** Patch one node's mutable fields; returns the full new canvas. */
  @Remote('updateNode')
  updateNode(agent: Agent, nodeId: string, patch: CanvasUpdateNodeRequest): CanvasState {
    const session = agent.session
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
  moveNode(agent: Agent, nodeId: string, x: number, y: number): CanvasState {
    const session = agent.session
    const before = foldCanvas(session.snapshotEvents())
    const next = updateNode(before, nodeId, { x, y })
    session.append('canvas/state', { state: next })
    return next
  }

  /** Link two nodes; returns the full new canvas. */
  @Remote('link')
  link(agent: Agent, request: CanvasLinkRequest): CanvasState {
    const session = agent.session
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

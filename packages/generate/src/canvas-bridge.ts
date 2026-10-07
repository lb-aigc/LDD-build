/**
 * @ldd/dsh-generate — minimal canvas bridge.
 *
 * The async generation path writes its results DIRECTLY onto the canvas by
 * appending the SAME whole-value `canvas/state` session event the
 * `@ldd/dsh-canvas` plugin persists and projects. This file is a
 * dependency-light STRUCTURAL copy of the canvas data model (kept in
 * `@ldd/dsh-canvas/src/model.ts`) — pure functions + data types only, no
 * cordis / dsh-tools / dsh-canvas import — so the two plugins emit
 * byte-compatible events without generate depending on canvas.
 *
 * The canvas shape that matters here:
 *   - an image node's `url` IS its content-addressed `sha256:…` attachment id;
 *   - its `meta` carries `width`/`height`/`mediaType`/`bytes` so the client can
 *     read the bytes back through the canvas `readAsset` channel;
 *   - a "生成中…" placeholder is a node with `meta.pending === true`, filled by
 *     `updateNode` once the real image lands.
 */

export type CanvasNodeKind = 'image' | 'video' | 'music' | 'text' | 'note'

export interface CanvasImageVariant {
  attachmentId: string
  mediaType?: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

export interface CanvasNode {
  id: string
  kind: CanvasNodeKind
  label: string
  x: number
  y: number
  attachmentId?: string
  url?: string
  variants?: CanvasImageVariant[]
  primaryIndex?: number
  meta?: Record<string, unknown>
  content?: string
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface CanvasState {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** Empty canvas (mirrors `@ldd/dsh-canvas` `emptyCanvas`). */
export function emptyCanvas(): CanvasState {
  return { nodes: [], edges: [] }
}

/** A single durable session event (structural slice of the harness SessionEvent). */
export interface SessionEventLike {
  type: string
  data: unknown
}

/** Host-side sessions store slice: resolve a live Session by id and read/append. */
export interface SessionStoreLike {
  get(sessionId: string): SessionLike | undefined
}

export interface SessionLike {
  append(type: string, data: unknown): void
  snapshotEvents(): readonly SessionEventLike[]
}

/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
export function foldCanvas(events: readonly SessionEventLike[]): CanvasState {
  let state = emptyCanvas()
  for (const event of events) {
    if (event.type === 'canvas/state') {
      state = (event.data as { state: CanvasState }).state
    }
  }
  return state
}

/** Add a node (id auto-minted unless a non-colliding id is supplied). */
export function addNode(state: CanvasState, node: Omit<CanvasNode, 'id'> & { id?: string }): { state: CanvasState; node: CanvasNode } {
  const id = node.id !== undefined && node.id !== '' && !state.nodes.some((n) => n.id === node.id)
    ? node.id
    : crypto.randomUUID()
  const added: CanvasNode = { ...node, id }
  return { state: { ...state, nodes: [...state.nodes, added] }, node: added }
}

/** Patch one node's mutable fields (idempotent on a missing id). */
export function updateNode(
  state: CanvasState,
  nodeId: string,
  patch: Partial<Pick<CanvasNode, 'label' | 'x' | 'y' | 'content' | 'meta' | 'url' | 'variants' | 'primaryIndex'>>,
): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  }
}

/** Find a pending placeholder node by its `meta.taskId` (the async task it is
 *  waiting on). Returns its id, or undefined when absent (e.g. the user deleted
 *  the placeholder mid-generation — the caller then drops the result). */
export function findPendingNodeByTaskId(state: CanvasState, taskId: string): CanvasNode | undefined {
  return state.nodes.find((n) => n.meta?.pending === true && n.meta.taskId === taskId)
}

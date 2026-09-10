/**
 * Canvas data model + pure state transitions. Kept dependency-light (no
 * cordis / dsh-tools / react) so `tests/model.verify.ts` can exercise it
 * directly under the Node strip-only verify harness, and so the Host half and
 * the Client half share ONE source of truth for node/edge shape.
 */

/** Lossless JSON value — the ceiling for anything the canvas persists. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** What a canvas node holds. Assets (image/video/music) reference an attachment
 *  or URL; text/note nodes carry inline content. */
export type CanvasNodeKind = 'image' | 'video' | 'music' | 'text' | 'note'

/** One node on the canvas. Stable across a session; persisted whole. */
export interface CanvasNode {
  /** Stable id (uuid). */
  id: string
  kind: CanvasNodeKind
  /** Display title. */
  label: string
  /** Canvas coordinates (flow-space, not screen px). */
  x: number
  y: number
  /** Content-addressed attachment id (`sha256:...`), for asset nodes. */
  attachmentId?: string
  /** Transient URL (not persisted — regenerated per session). */
  url?: string
  /** Per-kind metadata: width/height for image, duration/aspect for video, … */
  meta?: Record<string, JsonValue>
  /** Inline content for text/note nodes. */
  content?: string
}

/** One directed relation between two nodes. */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  /** Human relation label, e.g. "参考", "依赖". */
  label?: string
}

/** The whole canvas for one session. */
export interface CanvasState {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** Empty canvas. */
export function emptyCanvas(): CanvasState {
  return { nodes: [], edges: [] }
}

/** New node id. `crypto.randomUUID` exists in Node ≥ 16 and all browsers. */
export function newId(): string {
  return crypto.randomUUID()
}

/**
 * Add a node. Returns the new state and the added node (with its generated id).
 * Ids are de-duped: a caller-supplied id that collides is re-minted.
 */
export function addNode(state: CanvasState, node: Omit<CanvasNode, 'id'> & { id?: string }): { state: CanvasState; node: CanvasNode } {
  const id = node.id !== undefined && node.id !== '' && !state.nodes.some((n) => n.id === node.id)
    ? node.id
    : newId()
  const added: CanvasNode = { ...node, id }
  return { state: { ...state, nodes: [...state.nodes, added] }, node: added }
}

/**
 * Remove a node and every edge touching it. Idempotent: a missing id is a
 * no-op returning the same state.
 */
export function removeNode(state: CanvasState, nodeId: string): CanvasState {
  if (!state.nodes.some((n) => n.id === nodeId)) return state
  return {
    nodes: state.nodes.filter((n) => n.id !== nodeId),
    edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  }
}

/** Add a directed edge. Both endpoints must exist, else it throws. */
export function addEdge(state: CanvasState, edge: Omit<CanvasEdge, 'id'> & { id?: string }): { state: CanvasState; edge: CanvasEdge } {
  const sourceExists = state.nodes.some((n) => n.id === edge.source)
  const targetExists = state.nodes.some((n) => n.id === edge.target)
  if (!sourceExists || !targetExists) {
    throw new Error(`canvas_link 需要两个已存在的节点（source=${edge.source} target=${edge.target}）`)
  }
  const id = edge.id !== undefined && edge.id !== '' ? edge.id : newId()
  const added: CanvasEdge = { ...edge, id }
  return { state: { ...state, edges: [...state.edges, added] }, edge: added }
}

/** Patch one node's mutable fields. Missing id is a no-op. */
export function updateNode(state: CanvasState, nodeId: string, patch: Partial<Pick<CanvasNode, 'label' | 'x' | 'y' | 'content' | 'meta' | 'url'>>): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  }
}

/** Find one node by id. */
export function findNode(state: CanvasState, nodeId: string): CanvasNode | undefined {
  return state.nodes.find((n) => n.id === nodeId)
}

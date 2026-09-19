/**
 * @ldd/dsh-canvas/types — the wire types of the canvas Remote boundary.
 *
 * Typert requires every Remote parameter/result type to be exported from a
 * PUBLIC NON-ROOT type subpath (`./types`), not from the package root. This
 * file is that outlet: it re-exports the canvas data model (kept in
 * `./model.ts`, the shared dependency-light source of truth) and declares the
 * Remote request payloads. Pure types only — no cordis / dsh-tools / react.
 *
 * @module @ldd/dsh-canvas/types
 */

import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasState, JsonValue } from './model.ts'

export type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasState, JsonValue }

/** New-node input for {@link CanvasService.addNode}. */
export interface CanvasAddNodeRequest {
  kind: CanvasNode['kind']
  label: string
  x?: number
  y?: number
  content?: string
  url?: string
  meta?: Record<string, JsonValue>
}

/** New-edge input for {@link CanvasService.link}. */
export interface CanvasLinkRequest {
  source: string
  target: string
  label?: string
}

/** Patch input for {@link CanvasService.updateNode}. */
export interface CanvasUpdateNodeRequest {
  label?: string
  x?: number
  y?: number
  content?: string
  meta?: Record<string, JsonValue>
}

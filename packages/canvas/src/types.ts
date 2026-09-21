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
  /** Caller-supplied id (optional). Lets the client build node+edge in one
   *  shot: mint the id, addNode({ id }), then link({ source, target: id }). */
  id?: string
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

/** One user-uploaded asset to store durably before it becomes a node. */
export interface CanvasSaveAssetRequest {
  /** Asset kind, decides image normalization vs verbatim file storage. */
  kind: 'image' | 'video' | 'audio'
  /** Display name (the file's leaf name). */
  name: string
  /** MIME type — REQUIRED for images (drives `saveImage` normalization); ignored for verbatim files. */
  mediaType?: string
  /** Canonical base64 of the file bytes. */
  dataBase64: string
}

/** Result of storing one asset: its content-addressed attachment id (+ image size). */
export interface CanvasSaveAssetValue {
  /** `sha256:...` attachment id; the client stores this as the node's `url`. */
  attachmentId: string
  /** Normalized image width in px (images only). */
  width?: number
  /** Normalized image height in px (images only). */
  height?: number
}

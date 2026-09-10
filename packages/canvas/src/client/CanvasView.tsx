/**
 * CanvasView: the conversation view tab rendering the per-session canvas.
 *
 * Reads the whole canvas through `useProjection('canvas')` and renders it with
 * React Flow. Image nodes resolve their `sha256:` attachment (or an http url)
 * into a thumbnail via the injected `loadImage`; text/note nodes show inline
 * content. MVP posture is READ-ONLY presentation: the agent mutates through
 * the `canvas_*` tools, the user can pan / zoom / inspect, and node dragging is
 * disabled until the write-back path (right-side panel phase) lands.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasNode, CanvasState } from '../model.ts'
import './canvas.css?inline'

/** Injected per-session image loader: `sha256:<attachmentId>` → blob URL. */
export interface CanvasViewInjected {
  loadImage: (attachmentId: string) => Promise<string>
}

const LoadImageContext = createContext<(attachmentId: string) => Promise<string>>(
  async () => { throw new Error('canvas: no image loader injected') },
)

/** A node's `url` is either a `sha256:` attachment id or a plain http(s) url. */
function isShaAttachment(url: string | undefined): url is string {
  return url !== undefined && url.startsWith('sha256:')
}

interface CanvasNodeData {
  label: string
  kind: CanvasNode['kind']
  content?: string
  url?: string
}

/** One node card, shared across kinds (kind tint via `data-kind`). */
function CanvasNodeCard({ data }: { data: CanvasNodeData }) {
  const loadImage = useContext(LoadImageContext)
  const [resolved, setResolved] = useState<string | null>(null)
  const sha = isShaAttachment(data.url)

  useEffect(() => {
    if (data.kind !== 'image' || !sha) {
      setResolved(null)
      return
    }
    let cancelled = false
    loadImage(data.url)
      .then((url) => { if (!cancelled) setResolved(url) })
      .catch(() => { if (!cancelled) setResolved(null) })
    return () => { cancelled = true }
  }, [data.kind, data.url, sha, loadImage])

  const src: string | null = sha
    ? resolved
    : (data.url !== undefined && data.url !== '' ? data.url : null)

  return (
    <div className="ldd-canvas-node" data-kind={data.kind}>
      {data.kind === 'image' && src !== null && (
        <img className="ldd-canvas-node-image" src={src} alt={data.label} />
      )}
      <div className="ldd-canvas-node-label">{data.label}</div>
      {data.content !== undefined && data.content !== '' && (
        <div className="ldd-canvas-node-content">{data.content}</div>
      )}
    </div>
  )
}

const nodeTypes: NodeTypes = {
  image: CanvasNodeCard,
  video: CanvasNodeCard,
  music: CanvasNodeCard,
  text: CanvasNodeCard,
  note: CanvasNodeCard,
}

function toFlowNodes(state: CanvasState): Node[] {
  return state.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    data: { label: n.label, kind: n.kind, content: n.content, url: n.url },
  }))
}

function toFlowEdges(state: CanvasState): Edge[] {
  return state.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.label === undefined || e.label === '' ? {} : { label: e.label }),
  }))
}

export function CanvasView({ useProjection, loadImage }: ConvViewProps & InjectFace<CanvasViewInjected>) {
  const canvas = useProjection('canvas')
  const nodes = useMemo(() => (canvas === undefined ? [] : toFlowNodes(canvas)), [canvas])
  const edges = useMemo(() => (canvas === undefined ? [] : toFlowEdges(canvas)), [canvas])

  if (canvas === undefined) {
    return <div className="ldd-canvas-empty">画布不可用（canvas 插件未挂载）。</div>
  }
  if (canvas.nodes.length === 0) {
    return (
      <div className="ldd-canvas-empty">
        画布当前为空。在对话中让智能体往画布添加节点（例如「把这几张图放到画布上」），或直接调用 canvas 工具。
      </div>
    )
  }

  return (
    <LoadImageContext.Provider value={loadImage}>
      <div className="ldd-canvas-root">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
    </LoadImageContext.Provider>
  )
}

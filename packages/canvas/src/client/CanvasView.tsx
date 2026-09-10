/**
 * CanvasView: the conversation view tab rendering the per-session canvas.
 *
 * Reads the whole canvas through `useProjection('canvas')` and renders it with
 * React Flow. MVP posture is READ-ONLY presentation: nodes and edges are the
 * projection (agent-mutated through the `canvas_*` tools), the user can pan /
 * zoom / inspect, and node dragging is disabled until the write-back path
 * (Phase 9, right-side panel) lands.
 */
import { useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CanvasNode, CanvasState } from '../model.ts'
import './canvas.css?inline'

/** One node card, shared across kinds (kind tint via `data-kind`). */
function CanvasNodeCard({ data }: { data: { label: string; kind: CanvasNode['kind']; content?: string } }) {
  return (
    <div className="ldd-canvas-node" data-kind={data.kind}>
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
    data: { label: n.label, kind: n.kind, content: n.content },
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

export function CanvasView({ useProjection }: ConvViewProps) {
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
  )
}

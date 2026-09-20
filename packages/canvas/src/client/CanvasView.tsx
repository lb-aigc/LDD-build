/**
 * CanvasView: the per-session canvas, drawn in whichever seat hosts it — today
 * the right Sidebar's `canvas` page tab and the Conversation's 画布 view tab,
 * both of which hand it `useProjection` and the injected image loader.
 *
 * Reads the whole canvas through `useProjection('canvas')` and renders it with
 * React Flow. Image nodes resolve their `sha256:` attachment (or an http url)
 * into a thumbnail via the injected `loadImage`; text/note nodes show inline
 * content. MVP posture is READ-ONLY presentation: the agent mutates through
 * the `canvas_*` tools, the user can pan / zoom / inspect, and node dragging is
 * disabled until the write-back path (right-side panel phase) lands.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasNode, CanvasState, JsonValue } from '../model.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasUpdateNodeRequest } from '../types.ts'
import './react-flow.css'
import './canvas.css'

/** The write-back verbs the seat face exposes (the client half of CanvasService). */
export interface CanvasWriteback {
  addNode(request: CanvasAddNodeRequest): Promise<CanvasState>
  removeNode(nodeId: string): Promise<CanvasState>
  updateNode(nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasState>
  moveNode(nodeId: string, x: number, y: number): Promise<CanvasState>
  link(request: CanvasLinkRequest): Promise<CanvasState>
}

/** Injected per-session canvas face: image loader + one-shot agent prompt + write-back. */
export interface CanvasViewInjected extends CanvasWriteback {
  loadImage: (attachmentId: string) => Promise<string>
  ask: (text: string) => Promise<void>
}

/**
 * What the canvas needs from a seat, spelled structurally so ONE component can
 * be registered in both the right Sidebar's tab body and the Conversation's view
 * tab: every session-scoped seat hands over the same Session standard props, and
 * both registrations inject the same `loadImage` face. The projection hook's type
 * is read off the seat that declares it instead of restated, so a seat change
 * surfaces here rather than drifting silently.
 */
export interface CanvasViewProps {
  /** Host-computed projection values; `canvas` is this plugin's projection. */
  useProjection: PropsRuntime<'sidebar.right.pane.tab'>['useProjection']
  /** Injected per-session image loader. */
  loadImage: CanvasViewInjected['loadImage']
  /** Injected one-shot agent prompt (ask about a selected node). */
  ask: CanvasViewInjected['ask']
  /** Injected write-back verbs (user edits land as durable canvas/state events). */
  addNode: CanvasWriteback['addNode']
  removeNode: CanvasWriteback['removeNode']
  updateNode: CanvasWriteback['updateNode']
  moveNode: CanvasWriteback['moveNode']
  link: CanvasWriteback['link']
}

const LoadImageContext = createContext<(attachmentId: string) => Promise<string>>(
  async () => { throw new Error('canvas: no image loader injected') },
)

/** A node's `url` is either a `sha256:` attachment id or a plain http(s) url. */
function isShaAttachment(url: string | undefined): url is string {
  return url !== undefined && url.startsWith('sha256:')
}

/** A plain, browser-loadable image URL (NOT mock:// / other placeholder schemes). */
function isHttpUrl(url: string | undefined): url is string {
  return url !== undefined && (url.startsWith('http://') || url.startsWith('https://'))
}

interface CanvasNodeData {
  label: string
  kind: CanvasNode['kind']
  content?: string
  url?: string
  meta?: Record<string, JsonValue>
}

/** Human-readable kind caption for the card head. */
const KIND_LABEL: Record<CanvasNode['kind'], string> = {
  image: '图片',
  video: '视频',
  music: '音乐',
  text: '文本',
  note: '笔记',
}

/** One inline kind glyph (16×16, stroke currentColor, consistent with the header button). */
function kindIcon(kind: CanvasNode['kind']): ReactNode {
  const common = {
    viewBox: '0 0 16 16',
    width: 14,
    height: 14,
    'aria-hidden': true,
    focusable: false,
  } as const
  switch (kind) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <circle cx="5" cy="6" r="1.4" />
          <path d="M2.5 12.5l3.2-3.2 2.4 2.4 2.2-2.2 3.2 3" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="1.5" y="3" width="13" height="10" rx="2" />
          <path d="M6.5 5.5l4 2.5-4 2.5z" />
        </svg>
      )
    case 'music':
      return (
        <svg {...common}>
          <path d="M6 2.5v8.2" />
          <path d="M6 10.7a1.8 1.8 0 1 1-1.8-1.8" />
          <path d="M6 5.3l6.5-1.8v6" />
          <path d="M12.5 9.5a1.8 1.8 0 1 1-1.8-1.8" />
        </svg>
      )
    case 'text':
      return (
        <svg {...common}>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </svg>
      )
    case 'note':
      return (
        <svg {...common}>
          <path d="M3 2.5h8l2 2V13.5H3z" />
          <path d="M11 2.5V4.5h2" />
          <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
        </svg>
      )
  }
}

/** Format a seconds count as m:ss (a media node's duration meta). */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/**
 * A one-line fact line for the card head, derived from a node's `meta`.
 * Returns undefined when the node carries nothing worth surfacing.
 */
function metaText(kind: CanvasNode['kind'], meta: Record<string, JsonValue> | undefined): string | undefined {
  if (meta === undefined) return undefined
  if (kind === 'image') {
    const width = meta['width']
    const height = meta['height']
    if (typeof width === 'number' && typeof height === 'number') return `${width} × ${height}`
    return undefined
  }
  if (kind === 'video' || kind === 'music') {
    const duration = meta['durationSeconds']
    if (typeof duration === 'number' && duration > 0) return formatDuration(duration)
    return undefined
  }
  return undefined
}

/** One node card: a head row (kind glyph + caption + meta fact) over a kind body. */
function CanvasNodeCard({ data }: { data: CanvasNodeData }) {
  const loadImage = useContext(LoadImageContext)
  const [resolved, setResolved] = useState<string | null>(null)
  const sha = isShaAttachment(data.url)
  const fact = metaText(data.kind, data.meta)

  useEffect(() => {
    const url = data.url
    if (data.kind !== 'image' || !isShaAttachment(url)) {
      setResolved(null)
      return
    }
    let cancelled = false
    loadImage(url)
      .then((resolvedUrl) => { if (!cancelled) setResolved(resolvedUrl) })
      .catch(() => { if (!cancelled) setResolved(null) })
    return () => { cancelled = true }
  }, [data.kind, data.url, loadImage])

  // Resolve an image node's <img> src. `sha256:` → loaded blob; http(s) → verbatim;
  // anything else (mock-image://, empty) → null → render a friendly placeholder
  // instead of a broken image.
  const src: string | null = sha
    ? resolved
    : (isHttpUrl(data.url) ? data.url : null)

  const hasTextBody = data.kind === 'text' || data.kind === 'note'

  return (
    <div className="ldd-canvas-node" data-kind={data.kind}>
      {/* Handles give React Flow endpoints for edges — without them edges do not
          render. isConnectable={false} keeps the read-only posture. */}
      <Handle type="target" position={Position.Left} className="ldd-canvas-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="ldd-canvas-handle" isConnectable={false} />

      <div className="ldd-canvas-node-head">
        <span className="ldd-canvas-node-kind">{kindIcon(data.kind)}<span>{KIND_LABEL[data.kind]}</span></span>
        {fact !== undefined && <span className="ldd-canvas-node-fact">{fact}</span>}
      </div>

      {data.kind === 'image' && (
        src !== null
          ? <img className="ldd-canvas-node-image" src={src} alt={data.label} />
          : <div className="ldd-canvas-node-image ldd-canvas-image-placeholder">{kindIcon('image')}图片</div>
      )}

      {data.kind === 'video' && (
        <div className="ldd-canvas-node-media">
          <span className="ldd-canvas-node-media-glyph">{kindIcon('video')}</span>
          <span className="ldd-canvas-node-media-caption">视频素材</span>
        </div>
      )}

      {data.kind === 'music' && (
        <div className="ldd-canvas-node-media">
          <span className="ldd-canvas-node-media-glyph">{kindIcon('music')}</span>
          <span className="ldd-canvas-node-media-caption">音频素材</span>
        </div>
      )}

      {hasTextBody && (
        <div className="ldd-canvas-node-text">
          {data.content === undefined || data.content === ''
            ? <span className="ldd-canvas-node-text-empty">（无内容）</span>
            : data.content}
        </div>
      )}

      <div className="ldd-canvas-node-label">{data.label}</div>
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
    data: { label: n.label, kind: n.kind, content: n.content, url: n.url, meta: n.meta },
  }))
}

function toFlowEdges(state: CanvasState): Edge[] {
  return state.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    ...(e.label === undefined || e.label === '' ? {} : { label: e.label }),
  }))
}

/** A node the user has clicked, kept lean (only what the ask bar needs). */
interface SelectedNode {
  id: string
  label: string
  kind: CanvasNode['kind']
}

export function CanvasView({ useProjection, loadImage, ask, addNode, removeNode, updateNode, moveNode, link }: CanvasViewProps) {
  const canvas = useProjection('canvas')
  const nodes = useMemo(() => (canvas === undefined ? [] : toFlowNodes(canvas)), [canvas])
  const edges = useMemo(() => (canvas === undefined ? [] : toFlowEdges(canvas)), [canvas])
  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const [question, setQuestion] = useState('')

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

  const submit = (): void => {
    if (selected === null) return
    const text = question.trim()
    if (text === '') return
    void ask(`关于画布上的节点「${selected.label}」（${KIND_LABEL[selected.kind]}），${text}`)
    setSelected(null)
    setQuestion('')
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
          onNodeClick={(_, node) => {
            const data = node.data as unknown as CanvasNodeData
            setSelected({ id: node.id, label: data.label, kind: data.kind })
            setQuestion('')
          }}
          onPaneClick={() => { setSelected(null); setQuestion('') }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
        {selected !== null && (
          <div className="ldd-canvas-ask">
            <span className="ldd-canvas-ask-title">问 agent · {selected.label}</span>
            <input
              className="ldd-canvas-ask-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
              placeholder="关于这个节点你想问什么？"
              autoFocus
            />
            <button
              type="button"
              className="ldd-canvas-ask-submit"
              onClick={submit}
              disabled={question.trim() === ''}
            >
              发送
            </button>
          </div>
        )}
      </div>
    </LoadImageContext.Provider>
  )
}

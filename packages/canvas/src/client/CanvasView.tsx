/**
 * CanvasView: the per-session canvas, drawn in whichever seat hosts it — today
 * the right Sidebar's `canvas` page tab and the Conversation's 画布 view tab,
 * both of which hand it `useProjection` and the injected image loader.
 *
 * Reads the whole canvas through `useProjection('canvas')` and renders it with
 * React Flow. Image nodes resolve their `sha256:` attachment (or an http url)
 * into a thumbnail via the injected `loadImage`; text/note nodes show inline
 * content.
 *
 * Phase 3 — the user edits the canvas directly, with zero agent round-trip:
 * - DRAG a node (React Flow keeps it responsive locally via `applyNodeChanges`;
 *   `onNodeDragStop` persists through the `moveNode` verb).
 * - CONNECT two nodes by dragging a handle (persists through `link`).
 * - ADD a note/text node from the toolbar (persists through `addNode`).
 * - EDIT label/content and DELETE via the bottom edit bar on a selected node
 *   (`updateNode` / `removeNode`).
 *
 * Every write lands as a durable `canvas/state` event on the Host, so the
 * projection re-renders from the SAME mirror the `canvas_*` tools mutate — agent
 * and user edits share one durable source of truth. Writes are fire-and-forget
 * with local feedback; the projection's refresh is the authoritative reconcile.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import type { Edge, FinalConnectionState, Node, NodeTypes, OnConnect, OnConnectStartParams, ReactFlowInstance } from '@xyflow/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { newId } from '../model.ts'
import type { CanvasNode, CanvasState, JsonValue } from '../model.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasUpdateNodeRequest } from '../types.ts'
import './react-flow.css'
import './canvas.css'

/** Local-only ids for the drag-to-create ghost node + dashed edge overlay. */
const GHOST_NODE_ID = '__draft-target__'
const GHOST_EDGE_ID = '__draft-edge__'

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
  /** Open the native file picker (menu-bar upload). */
  pickFiles: () => Promise<File[]>
  /** Store the given files (image → attachment, video/audio → workspace) and
   *  return the ones that map to a canvas asset kind. */
  uploadFiles: (files: File[]) => Promise<CanvasUploadedAsset[]>
}

/** One media file that was uploaded and can become a canvas node. */
export interface CanvasUploadedAsset {
  name: string
  kind: 'image' | 'video' | 'music'
  /** Content-addressed attachment id (images only; the node's `url`). */
  attachmentId?: string
  /** Normalized image width in px (images only). */
  width?: number
  /** Normalized image height in px (images only). */
  height?: number
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
  /** Injected file picker (menu-bar upload). */
  pickFiles: CanvasViewInjected['pickFiles']
  /** Injected file store (image → attachment, video/audio → workspace). */
  uploadFiles: CanvasViewInjected['uploadFiles']
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

/** Write-back actions reachable from deep inside a node card (the delete button). */
const CanvasActionsContext = createContext<{ removeNode: (nodeId: string) => void }>({
  removeNode: () => {},
})

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
function CanvasNodeCard({ id, data }: { id: string; data: CanvasNodeData }) {
  const loadImage = useContext(LoadImageContext)
  const { removeNode } = useContext(CanvasActionsContext)
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

  // Image cards size to the picture's aspect ratio (short edge 200px, long edge
  // capped at 360px) so the image is fully shown — no `object-fit: cover` crop.
  const metaWidth = data.meta?.['width']
  const metaHeight = data.meta?.['height']
  const imageW = typeof metaWidth === 'number' && metaWidth > 0 ? metaWidth : undefined
  const imageH = typeof metaHeight === 'number' && metaHeight > 0 ? metaHeight : undefined
  let displayW = 240
  let displayH = 180
  if (imageW !== undefined && imageH !== undefined) {
    const ratio = imageW / imageH
    const short = 200
    const long = Math.min(360, short * Math.max(ratio, 1 / ratio))
    if (ratio >= 1) { displayW = long; displayH = long / ratio }
    else { displayW = long * ratio; displayH = long }
  }

  return (
    <div className="ldd-canvas-node" data-kind={data.kind}>
      {/* Handles give React Flow endpoints for edges; connectable so the user can
          drag a link between nodes (persisted via the `link` verb). */}
      <Handle type="target" position={Position.Left} className="ldd-canvas-handle" />
      <Handle type="source" position={Position.Right} className="ldd-canvas-handle" />

      <button
        type="button"
        className="ldd-canvas-node-delete"
        title="删除节点"
        aria-label={`删除「${data.label}」`}
        onClick={(event) => {
          event.stopPropagation()
          removeNode(id)
        }}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M6.5 6.5v5M9.5 6.5v5" />
        </svg>
      </button>

      <div className="ldd-canvas-node-head">
        <span className="ldd-canvas-node-kind">{kindIcon(data.kind)}<span>{KIND_LABEL[data.kind]}</span></span>
        {fact !== undefined && <span className="ldd-canvas-node-fact">{fact}</span>}
      </div>

      {data.kind === 'image' && (
        src !== null
          ? <img className="ldd-canvas-node-image" src={src} alt={data.label} style={{ width: displayW, height: displayH }} />
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

/** The drop target shown while a dragged connection awaits its new node:
 *  a dashed "＋" marker at the release point. The ghost node + dashed edge are
 *  local-only (never written back) — picking a menu item replaces them with the
 *  real node + a solid edge. */
function DraftTargetNode() {
  return (
    <div className="ldd-canvas-draft-target">
      <span className="ldd-canvas-draft-plus">＋</span>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  image: CanvasNodeCard,
  video: CanvasNodeCard,
  music: CanvasNodeCard,
  text: CanvasNodeCard,
  note: CanvasNodeCard,
  draft: DraftTargetNode,
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
    // 'default' = bezier (smooth curve); 'smoothstep' was the angular fold.
    type: 'default',
    ...(e.label === undefined || e.label === '' ? {} : { label: e.label }),
  }))
}

/** A node the user has selected for editing / asking. */
interface SelectedNode {
  id: string
  label: string
  kind: CanvasNode['kind']
  content?: string
}

export function CanvasView({ useProjection, loadImage, ask, pickFiles, uploadFiles, addNode, removeNode, updateNode, moveNode, link }: CanvasViewProps) {
  const canvas = useProjection('canvas')

  // Local, RESPONSIVE flow state: the projection is the authoritative mirror,
  // but dragging must feel immediate, so React Flow's `applyNodeChanges` mutates
  // a local copy on every drag frame; the projection refresh reconciles it.
  const [flowNodes, setFlowNodes] = useState<Node[]>([])
  const [flowEdges, setFlowEdges] = useState<Edge[]>([])

  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [question, setQuestion] = useState('')

  // The React Flow instance, captured on init so a pane double-click can map a
  // viewport (screen) coordinate into flow-space for placing a new node.
  const rfRef = useRef<ReactFlowInstance | null>(null)
  // The add-node menu, opened by double-clicking empty canvas OR by dropping a
  // dragged connection on empty canvas: screen position (for the floating menu)
  // + flow position (where the new node lands) + optional source node (a
  // drag-to-create, so the new node gets wired to that source).
  const [menu, setMenu] = useState<{ x: number; y: number; flowX: number; flowY: number; sourceNodeId?: string } | null>(null)
  const lastPaneClick = useRef<{ time: number; x: number; y: number } | null>(null)
  // The node a dragged connection left from (set onConnectStart, read+cleared onConnectEnd).
  const connectSourceRef = useRef<string | null>(null)

  // Reconcile local flow state from the projection (authoritative) on every change.
  useEffect(() => {
    if (canvas !== undefined) {
      setFlowNodes(toFlowNodes(canvas))
      setFlowEdges(toFlowEdges(canvas))
    }
  }, [canvas])

  // While a dragged connection awaits its new node, overlay a local ghost node +
  // a dashed edge so the user sees the pending link (the release point + the
  // line that turns solid once a menu item is picked). Local-only: picking an
  // item writes the real node + edge, and the projection reconcile drops the
  // ghost. A double-click menu (no source) renders no overlay.
  const displayNodes = useMemo<Node[]>(() => {
    if (menu === null || menu.sourceNodeId === undefined) return flowNodes
    const ghost: Node = {
      id: GHOST_NODE_ID,
      type: 'draft',
      position: { x: menu.flowX, y: menu.flowY },
      data: {},
      draggable: false,
      selectable: false,
      connectable: false,
    }
    return [...flowNodes, ghost]
  }, [flowNodes, menu])

  const displayEdges = useMemo<Edge[]>(() => {
    if (menu === null || menu.sourceNodeId === undefined) return flowEdges
    const dashed: Edge = {
      id: GHOST_EDGE_ID,
      source: menu.sourceNodeId,
      target: GHOST_NODE_ID,
      type: 'default',
      animated: true,
      style: { strokeDasharray: '6 6' },
    }
    return [...flowEdges, dashed]
  }, [flowEdges, menu])

  // Seed the edit drafts when a node is selected.
  useEffect(() => {
    if (selected !== null) {
      setDraftLabel(selected.label)
      setDraftContent(selected.content ?? '')
    }
  }, [selected])

  const onNodesChange = useCallback((changes: Parameters<typeof applyNodeChanges>[0]) => {
    setFlowNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange = useCallback((changes: Parameters<typeof applyEdgeChanges>[0]) => {
    setFlowEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  // Fire-and-forget write-back: log (not throw) so a transient failure never
  // takes the React tree down; the projection refresh is the reconcile.
  const run = useCallback((p: Promise<unknown>) => {
    void p.catch((error: unknown) => { console.error('[ldd-canvas] write-back failed:', error) })
  }, [])

  if (canvas === undefined) {
    return <div className="ldd-canvas-empty">画布不可用（canvas 插件未挂载）。</div>
  }

  const onDragStop = (_: unknown, node: Node): void => {
    run(moveNode(node.id, node.position.x, node.position.y))
  }

  const onConnect: OnConnect = (connection) => {
    const source = connection.source
    const target = connection.target
    if (source === null || target === null) return
    run(link({ source, target }))
  }

  // Start of a dragged connection: remember the source node, so a release on
  // empty canvas can offer "create a node here" wired back to that source.
  const onConnectStart = useCallback((_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    connectSourceRef.current = params.nodeId
  }, [])

  // End of a dragged connection. A valid drop already went through onConnect;
  // an empty-canvas release opens the add-node menu (the dashed ghost edge
  // stays on screen until a menu item is picked).
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    const source = connectSourceRef.current
    connectSourceRef.current = null
    if (source === null) return
    if (connectionState.isValid) return
    // MouseEvent carries clientX/Y directly; TouchEvent keeps them under `touches`.
    const point = event instanceof MouseEvent
      ? { x: event.clientX, y: event.clientY }
      : { x: event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? 0 }
    const flow = rfRef.current?.screenToFlowPosition({ x: point.x, y: point.y })
    if (flow === undefined) return
    setSelected(null)
    setQuestion('')
    setMenu({ x: point.x, y: point.y, flowX: flow.x, flowY: flow.y, sourceNodeId: source })
  }, [])

  // Double-click empty canvas → open the add-node menu at that spot. A single
  // click just clears selection (and closes the menu). The viewport coordinate
  // maps through the React Flow instance so the node lands under the cursor.
  const onPaneClick = (event: { clientX: number; clientY: number }): void => {
    setSelected(null)
    setQuestion('')
    const now = Date.now()
    const last = lastPaneClick.current
    const near = last !== null && now - last.time < 350
      && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 40
    if (near) {
      lastPaneClick.current = null
      const flow = rfRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setMenu({ x: event.clientX, y: event.clientY, flowX: flow?.x ?? 0, flowY: flow?.y ?? 0 })
    } else {
      lastPaneClick.current = { time: now, x: event.clientX, y: event.clientY }
      setMenu(null)
    }
  }

  // Place a new asset node at the double-click / connection-drop spot. For a
  // drag-to-create (a sourceNodeId), mint the id up front and wire the new node
  // to that source in the same breath, so the dashed ghost becomes a solid edge.
  // Await addNode BEFORE link — the write-back is fire-and-forget otherwise and
  // a concurrent link could reach the host before the target node exists.
  const addAssetNode = async (kind: 'image' | 'video' | 'music', label: string): Promise<void> => {
    if (menu === null) return
    const { flowX, flowY, sourceNodeId } = menu
    const id = newId()
    try {
      await addNode({ id, kind, label, x: flowX, y: flowY })
      if (sourceNodeId !== undefined) await link({ source: sourceNodeId, target: id })
    } catch (error) {
      console.error('[ldd-canvas] add-node (drag-to-create) failed:', error)
    }
    setMenu(null)
  }

  // Place a card for each stored asset at (flowX, flowY), grid-laid. Images
  // carry their attachment id (+ size) so the card renders the picture; on a
  // drag-to-create, the first asset wires to the source.
  const placeAssets = async (assets: CanvasUploadedAsset[], flowX: number, flowY: number, sourceNodeId?: string): Promise<void> => {
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!
      const col = index % 3
      const row = Math.floor(index / 3)
      const id = newId()
      const meta = asset.width !== undefined && asset.height !== undefined
        ? { width: asset.width, height: asset.height }
        : undefined
      try {
        await addNode({
          id, kind: asset.kind, label: asset.name, x: flowX + col * 40, y: flowY + row * 40,
          ...(asset.attachmentId === undefined ? {} : { url: asset.attachmentId }),
          ...(meta === undefined ? {} : { meta }),
        })
        if (sourceNodeId !== undefined && index === 0) await link({ source: sourceNodeId, target: id })
      } catch (error) {
        console.error('[ldd-canvas] upload node failed:', error)
      }
    }
  }

  // Menu-bar upload: open the picker, store the files, place the cards.
  const uploadAssets = async (): Promise<void> => {
    if (menu === null) return
    const { flowX, flowY, sourceNodeId } = menu
    const files = await pickFiles()
    if (files.length === 0) { setMenu(null); return }
    const assets = await uploadFiles(files).catch(() => [])
    await placeAssets(assets, flowX, flowY, sourceNodeId)
    setMenu(null)
  }

  // Drag-and-drop upload: files dropped on the canvas become cards at the drop
  // spot (images store + render; video/audio write to the workspace).
  const onCanvasDrop = async (event: ReactDragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    // stopPropagation is REQUIRED: the composer (conversation input) registers
    // document-level dragenter/dragover/drop listeners that would otherwise also
    // consume the same drop and add the files to the input attachment rail
    // instead of the canvas. Keeping the drop from bubbling to document means
    // the canvas owns files dropped over it.
    event.stopPropagation()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    const flow = rfRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const assets = await uploadFiles(files).catch((error: unknown) => {
      console.error('[ldd-canvas] upload failed:', error)
      return []
    })
    await placeAssets(assets, flow?.x ?? 0, flow?.y ?? 0)
  }

  const onCanvasDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    // Same reason as onDrop: don't let the composer's document-level dragover
    // (which flips its dropEffect and shows the global drop overlay) override
    // the canvas's own handling.
    event.stopPropagation()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }

  const saveEdit = (): void => {
    if (selected === null) return
    const patch: CanvasUpdateNodeRequest = {}
    const label = draftLabel.trim()
    if (label !== '' && label !== selected.label) patch.label = label
    if ((selected.kind === 'text' || selected.kind === 'note') && draftContent !== selected.content) {
      patch.content = draftContent
    }
    if (Object.keys(patch).length > 0) run(updateNode(selected.id, patch))
    setSelected(null)
  }

  const deleteSelected = (): void => {
    if (selected === null) return
    run(removeNode(selected.id))
    setSelected(null)
  }

  const submitAsk = (): void => {
    if (selected === null) return
    const text = question.trim()
    if (text === '') return
    void ask(`关于画布上的节点「${selected.label}」（${KIND_LABEL[selected.kind]}），${text}`)
    setQuestion('')
  }

  const actions = useMemo(() => ({
    removeNode: (nodeId: string) => {
      run(removeNode(nodeId))
      setSelected((sel) => (sel !== null && sel.id === nodeId ? null : sel))
    },
  }), [removeNode, run])

  return (
    <LoadImageContext.Provider value={loadImage}>
      <CanvasActionsContext.Provider value={actions}>
        <div
          className="ldd-canvas-root"
          onDragOver={onCanvasDragOver}
          onDrop={(event) => { void onCanvasDrop(event) }}
        >
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onInit={(rf) => { rfRef.current = rf }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onDragStop}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            // Left/middle/right all pan the empty canvas (right-drag = pan).
            panOnDrag={[0, 1, 2]}
            onNodeClick={(_, node) => {
              const data = node.data as unknown as CanvasNodeData
              setSelected({
                id: node.id,
                label: data.label,
                kind: data.kind,
                ...(data.content === undefined ? {} : { content: data.content }),
              })
              setQuestion('')
              setMenu(null)
            }}
            onPaneClick={onPaneClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>

          {canvas.nodes.length === 0 && (
            <div className="ldd-canvas-empty-hint">
              画布为空。双击画布添加节点，或在对话中让智能体往画布添加内容。
            </div>
          )}

          {menu !== null && (
            <div className="ldd-canvas-menu" style={{ left: menu.x, top: menu.y }}>
              <button type="button" onClick={() => { void uploadAssets() }}>上传</button>
              <button type="button" onClick={() => { void addAssetNode('image', '新图片') }}>图片</button>
              <button type="button" onClick={() => { void addAssetNode('music', '新音频') }}>音频</button>
              <button type="button" onClick={() => { void addAssetNode('video', '新视频') }}>视频</button>
            </div>
          )}

          {selected !== null && (
            <div className="ldd-canvas-edit">
              <div className="ldd-canvas-edit-row">
                <span className="ldd-canvas-edit-kind">{kindIcon(selected.kind)}<span>{KIND_LABEL[selected.kind]}</span></span>
                <input
                  className="ldd-canvas-edit-label"
                  value={draftLabel}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') saveEdit() }}
                  placeholder="节点标题"
                />
                <button type="button" className="ldd-canvas-edit-save" onClick={saveEdit}>保存</button>
                <button type="button" className="ldd-canvas-edit-delete" onClick={deleteSelected}>删除</button>
              </div>

              {(selected.kind === 'text' || selected.kind === 'note') && (
                <textarea
                  className="ldd-canvas-edit-content"
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  placeholder="内容…"
                  rows={3}
                />
              )}

              <div className="ldd-canvas-edit-row ldd-canvas-edit-ask">
                <span className="ldd-canvas-ask-title">问 agent</span>
                <input
                  className="ldd-canvas-ask-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') submitAsk() }}
                  placeholder="关于这个节点你想问什么？"
                />
                <button
                  type="button"
                  className="ldd-canvas-ask-submit"
                  onClick={submitAsk}
                  disabled={question.trim() === ''}
                >
                  发送
                </button>
              </div>
            </div>
          )}
        </div>
      </CanvasActionsContext.Provider>
    </LoadImageContext.Provider>
  )
}

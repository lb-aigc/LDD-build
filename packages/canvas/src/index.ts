/**
 * @ldd/dsh-canvas — Host half.
 *
 * Registers the `canvas_*` tools the agent calls to read and mutate the
 * per-session canvas, and drives a session projection (`canvas`) so the canvas
 * state is BOTH durably persisted (a whole-value `canvas/state` session event
 * per mutation, folded back on resume/fork) AND served to the client through
 * the standard `useProjection('canvas')` read face — zero upstream patches.
 *
 * The canvas is a plugin: this bundle installs as a profile layer, the tools
 * appear only when the bundle is mounted, and the harness core knows nothing
 * about the canvas.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves `ctx.sessionProjections` for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'

import { addEdge, addNode, emptyCanvas, removeNode, updateNode } from './model.ts'
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasState } from './model.ts'

export const name = 'ldd-canvas'
export const inject = ['tools']

// ---- Session event: whole-value canvas snapshot (the durable mirror). ----
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole canvas state after one mutation. Whole-value, never a delta. */
    'canvas/state': { state: CanvasState }
  }
}

// ---- Session projection: the client read face (`useProjection('canvas')`). ----
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    canvas: CanvasState
  }
  interface SessionProjectionMap {
    canvas: CanvasState
  }
}

// ---- zod schemas (plain-JSON requirement of the projection cache). ----
// `as ZodType<X>` bridges zod's `.optional()` (`T | undefined`) to the
// interface's `field?: T` under `exactOptionalPropertyTypes` (same idiom as
// the goal package's projection schema).
const canvasNodeSchema = zod.object({
  id: zod.string(),
  kind: zod.enum(['image', 'video', 'music', 'text', 'note']),
  label: zod.string(),
  x: zod.number(),
  y: zod.number(),
  attachmentId: zod.string().optional(),
  url: zod.string().optional(),
  meta: zod.record(zod.string(), zod.any()).optional(),
  content: zod.string().optional(),
}) as ZodType<CanvasNode>

const canvasEdgeSchema = zod.object({
  id: zod.string(),
  source: zod.string(),
  target: zod.string(),
  label: zod.string().optional(),
}) as ZodType<CanvasEdge>

const canvasStateSchema = zod.object({
  nodes: zod.array(canvasNodeSchema),
  edges: zod.array(canvasEdgeSchema),
}) as ZodType<CanvasState>

const NODE_KINDS: readonly CanvasNodeKind[] = ['image', 'video', 'music', 'text', 'note']

const KIND_LABEL: Record<CanvasNodeKind, string> = {
  image: '图片',
  video: '视频',
  music: '音乐',
  text: '文本',
  note: '笔记',
}

// ---- Output schema: exact description of the `canvas_inspect` return shape. ----
const inspectOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nodes: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          label: { type: 'string', required: true },
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
          attachmentId: { type: 'string' },
          url: { type: 'string' },
          meta: { type: 'json' },
          content: { type: 'string' },
        },
      },
    },
    edges: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          source: { type: 'string', required: true },
          target: { type: 'string', required: true },
          label: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', required: true },
  },
} as const

/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas(events: readonly SessionEvent[]): CanvasState {
  let state = emptyCanvas()
  for (const event of events) {
    if (event.type === 'canvas/state') state = event.data.state
  }
  return state
}

/** Serialize one canvas for the model-facing inspect result. */
function describeCanvas(state: CanvasState): string {
  if (state.nodes.length === 0) return '画布当前为空。'
  const nodes = state.nodes.map((n) => {
    const meta = n.meta === undefined || Object.keys(n.meta).length === 0 ? '' : ` ${JSON.stringify(n.meta)}`
    const extra = n.kind === 'text' || n.kind === 'note'
      ? (n.content === undefined ? '' : ` 内容="${n.content.slice(0, 80)}"`)
      : ''
    return `  - [${n.id}] ${KIND_LABEL[n.kind]} "${n.label}" @(${n.x},${n.y})${meta}${extra}`
  }).join('\n')
  const edges = state.edges.length === 0
    ? '（无连线）'
    : '\n' + state.edges.map((e) => `  - [${e.id}] ${e.source} -> ${e.target}${e.label === undefined ? '' : ` (${e.label})`}`).join('\n')
  return `画布节点（${state.nodes.length}）：\n${nodes}\n连线（${state.edges.length}）：${edges}`
}

/** The session driving the calling tool; missing = headless / no session. */
function sessionOf(exec: unknown): Session | undefined {
  return (exec as { agent?: { session?: Session } }).agent?.session
}

function defineCanvasTools() {
  const requireSession = (exec: unknown): Session => {
    const session = sessionOf(exec)
    if (session === undefined) throw new Error('canvas 工具需要当前会话（无法确定会话身份）')
    return session
  }

  const inspectTool = defineTool({
    name: 'canvas_inspect',
    description:
      '读取当前会话画布的全部内容：有哪些节点（图片/视频/音乐/文本/笔记）、每个节点的元数据和位置、节点之间的连线关系。调用此工具了解画布上已有的素材与依赖，再做后续操作。',
    parameters: {},
    output: {
      schema: inspectOutputSchema,
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const session = requireSession(exec)
      const state = foldCanvas(session.events)
      return { nodes: state.nodes, edges: state.edges, summary: describeCanvas(state) }
    },
  })

  const addNodeTool = defineTool({
    name: 'canvas_add_node',
    description:
      '在画布上新增一个节点。用于把素材（图片/视频/音乐）或文字/笔记组织到画布上，供后续参考或连线。返回新节点的 id。',
    parameters: {
      kind: { type: 'string', enum: [...NODE_KINDS], required: true, description: '节点类型：image=图片, video=视频, music=音乐, text=文本, note=笔记。' },
      label: { type: 'string', required: true, description: '节点显示标题。' },
      x: { type: 'number', description: '画布横坐标（可选，缺省自动布局）。' },
      y: { type: 'number', description: '画布纵坐标（可选，缺省自动布局）。' },
      content: { type: 'string', description: '文本/笔记节点的内容。' },
      url: { type: 'string', description: '素材节点的 URL（图片/视频/音乐直链）。' },
      meta: { type: 'object', additionalProperties: true, description: '素材元数据，如 {width,height} 或 {durationSeconds,aspectRatio}。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeId: { type: 'string', required: true },
          label: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已在画布新增节点「${value.label}」（id=${value.nodeId}）。` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = requireSession(exec)
      const state = foldCanvas(session.events)
      const auto = state.nodes.length
      const { state: next } = addNode(state, {
        kind: args.kind,
        label: args.label,
        x: typeof args.x === 'number' ? args.x : (auto % 4) * 220,
        y: typeof args.y === 'number' ? args.y : Math.floor(auto / 4) * 180,
        ...(args.content === undefined ? {} : { content: args.content }),
        ...(args.url === undefined ? {} : { url: args.url }),
        ...(args.meta === undefined ? {} : { meta: args.meta }),
      })
      session.append('canvas/state', { state: next })
      const added = next.nodes[next.nodes.length - 1]!
      return { nodeId: added.id, label: added.label }
    },
  })

  const removeNodeTool = defineTool({
    name: 'canvas_remove_node',
    description: '从画布删除一个节点（连同与它相连的所有连线）。',
    parameters: {
      nodeId: { type: 'string', required: true, description: '要删除的节点 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.removed ? '已从画布删除该节点。' : '未找到该节点，画布无变化。' }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = requireSession(exec)
      const before = foldCanvas(session.events)
      const next = removeNode(before, args.nodeId)
      session.append('canvas/state', { state: next })
      return { removed: next.nodes.length !== before.nodes.length }
    },
  })

  const updateNodeTool = defineTool({
    name: 'canvas_update_node',
    description: '修改画布上已有节点的标题、位置或元数据。',
    parameters: {
      nodeId: { type: 'string', required: true, description: '要修改的节点 id。' },
      label: { type: 'string', description: '新的显示标题。' },
      x: { type: 'number', description: '新的横坐标。' },
      y: { type: 'number', description: '新的纵坐标。' },
      content: { type: 'string', description: '新的文本/笔记内容。' },
      meta: { type: 'object', additionalProperties: true, description: '新的元数据。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { updated: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.updated ? '已更新该节点。' : '未找到该节点。' }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = requireSession(exec)
      const before = foldCanvas(session.events)
      const patch: Partial<Pick<CanvasNode, 'label' | 'x' | 'y' | 'content' | 'meta'>> = {}
      if (typeof args.label === 'string') patch.label = args.label
      if (typeof args.x === 'number') patch.x = args.x
      if (typeof args.y === 'number') patch.y = args.y
      if (typeof args.content === 'string') patch.content = args.content
      if (args.meta !== undefined && typeof args.meta === 'object') patch.meta = args.meta
      const next = updateNode(before, args.nodeId, patch)
      session.append('canvas/state', { state: next })
      return { updated: next !== before }
    },
  })

  const linkTool = defineTool({
    name: 'canvas_link',
    description: '在画布两个节点之间加一条连线，表达关系（如「参考」「依赖」「派生自」）。',
    parameters: {
      source: { type: 'string', required: true, description: '源节点 id。' },
      target: { type: 'string', required: true, description: '目标节点 id。' },
      label: { type: 'string', description: '关系说明（可选）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { edgeId: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `已连线（id=${value.edgeId}）。` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = requireSession(exec)
      const state = foldCanvas(session.events)
      const { state: next, edge } = addEdge(state, {
        source: args.source,
        target: args.target,
        ...(args.label === undefined ? {} : { label: args.label }),
      })
      session.append('canvas/state', { state: next })
      return { edgeId: edge.id }
    },
  })

  return [inspectTool, addNodeTool, removeNodeTool, updateNodeTool, linkTool]
}

export function apply(ctx: Context): void {
  // Session projection: the durable + client-visible canvas read face. Optional
  // (headless assemblies without a projection registry stay unaffected).
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'canvas', CanvasState>({
      key: 'canvas',
      stateSchema: canvasStateSchema,
      init: emptyCanvas,
      apply: (state, event) => (event.type === 'canvas/state' ? event.data.state : state),
      wire: {
        viewSchema: canvasStateSchema,
        view: (state) => state,
      },
      stateVersion: 1,
    })
  })

  const disposers = defineCanvasTools().map((tool) => ctx.tools.register(tool))
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'ldd-canvas: dispose tools')
}

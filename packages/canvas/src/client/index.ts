/**
 * @ldd/dsh-canvas — Browser half.
 *
 * The same canvas shows up in TWO seats, both fed by the ONE host-side truth
 * (`useProjection('canvas')`, which folds the durable `canvas/state` events):
 *
 * 1. The right Sidebar, as a page-type tab (`kind: 'canvas'`), registered
 *    through the stock public two-stage path — `ctx.sidebarRightTabs.register`
 *    for what the type IS, the keyed `sidebar.right.pane.tab` seat for its body.
 *    That is the same path `ui-sidebar-files` and `ui-sidebar-documentpreview`
 *    take, so it costs zero upstream patches. It deliberately claims NO guide
 *    entry: the shipped guide draws its own page whenever more than one entry is
 *    registered, which would turn the strip's add control from "open Files" into
 *    "open the guide". The way in is the always-mounted 「画布」 utility in the
 *    Session header below.
 * 2. The Conversation's own view tab (对话 / 轨迹 / 画布). Kept while the sidebar
 *    route beds in, so there is a fallback; delete this registration (and the
 *    `@deepseek-ai/dsh-client-ui-conversation` inject/peer edges) once the
 *    sidebar route has proven itself.
 *
 * Both seats are session-scoped, so the framework hands each body `useProjection`
 * and `sessionId` on its own. The face injected into each seat carries the image
 * loader, the one-shot agent prompt, AND the write-back verbs — the six typert
 * Remote methods of {@link CanvasService}, mounted here from the generated
 * `@ldd/dsh-canvas/remote` contribution and called directly with the session id
 * (the same direct shape the harness `session-controller` uses; no scope
 * machinery). Every write lands as a durable `canvas/state` event on the Host,
 * so the projection re-renders from the SAME mirror the `canvas_*` tools mutate.
 *
 * The right-Sidebar services are taken through `ctx.inject` rather than the
 * top-level `inject` list: the canvas has to keep working in a composition
 * without the right Sidebar, and a missing optional service must not take the
 * Conversation tab down with it. The host half uses the same idiom for its
 * optional `sessionProjections`.
 *
 * The sessions service is read through `ctx.get('sessions')` with a minimal
 * STRUCTURAL face (not `ctx.sessions.<method>`). This package's single tsconfig
 * compiles host + client halves together, and the host half imports
 * `@deepseek-ai/dsh-session` (declaring `Context.sessions: SessionStore`) while
 * the client half imports the runtime (declaring `Context.sessions: ISessions`);
 * a direct `ctx.sessions` property access would surface that conflict as
 * TS2339. `ctx.get` sidesteps it (same idiom as generate's `SessionsLike`). The
 * `remote` service is reached the same way (`ctx.get('remote')`) with a local
 * structural shim, so this package does NOT import `@deepseek-ai/dsh-api-gateway`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation)
// must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useProjection/sessionId seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ctx.sidebarRight / ctx.sidebarRightTabs and the keyed
// sidebar.right.pane.tab seat declaration.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { CanvasState } from '../model.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasUpdateNodeRequest } from '../types.ts'
import { CanvasView } from './CanvasView.tsx'
import { CanvasPanelButton } from './CanvasPanelButton.tsx'
// The generated Remote contribution (TYPERT_REMOTE): a pure descriptor/codec
// value, inlined by tsdown into lib/client.js (no shared runtime identity).
import canvasRemote from '@ldd/dsh-canvas/remote'

/** Structural read face of the runtime's `readAttachment` (brand-free). */
interface CanvasSessionLike {
  readAttachment(attachmentId: string): Promise<{
    ok: boolean
    error?: { code: string; message: string }
    value?: { attachment: { mediaType: string }; data: Uint8Array }
  }>
  /** Send one text prompt into the session's agent (queue mode). */
  prompt(content: readonly { readonly type: 'text'; readonly text: string }[], mode: 'queue' | 'steer'): Promise<unknown>
}

/** Structural read face of the runtime sessions service (binding lookup). */
interface CanvasSessionsLike {
  binding(id: SessionId): { session?: CanvasSessionLike } | undefined
}

/** One Remote result, the wire shape the generated remote-client returns. */
interface CanvasRemoteResult<T> {
  ok: boolean
  error?: { code: string; message: string }
  value?: T
}

/** The `canvas` Remote namespace as this package calls it (direct, sessionId first). */
interface CanvasRemoteNamespaceLike {
  addNode(sessionId: string, request: CanvasAddNodeRequest): Promise<CanvasRemoteResult<CanvasState>>
  removeNode(sessionId: string, nodeId: string): Promise<CanvasRemoteResult<CanvasState>>
  updateNode(sessionId: string, nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasRemoteResult<CanvasState>>
  moveNode(sessionId: string, nodeId: string, x: number, y: number): Promise<CanvasRemoteResult<CanvasState>>
  link(sessionId: string, request: CanvasLinkRequest): Promise<CanvasRemoteResult<CanvasState>>
  inspect(sessionId: string): Promise<CanvasRemoteResult<CanvasState>>
}

/** The Remote carrier as this package reaches it (mount + the canvas namespace). */
interface CanvasRemoteLike {
  $mount(contribution: unknown): Promise<unknown>
  canvas: CanvasRemoteNamespaceLike
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole per-session canvas (nodes + edges). */
    canvas: CanvasState
  }
}

/** The right-Sidebar page kind this plugin owns; `openTab('canvas')` names it. */
export const CANVAS_KIND = 'canvas'

/** This implementation's identity in the tab system, and the key both keyed seats register under. */
const CANVAS_ID = '@ldd/dsh-canvas'

export const inject = ['slots', 'sessions']

/**
 * The per-session canvas face both seats share: the image loader, the
 * one-shot "ask the agent about a node" prompt, and the write-back verbs.
 * @param ctx - client root context.
 * @returns the Slot `inject` factory: session in, face out.
 */
function createCanvasFace(ctx: ClientContext) {
  return (sessionId: SessionId) => {
    const sessionOf = (): CanvasSessionLike => {
      // Resolve lazily per call so a view mounted before the session bound
      // still loads once the binding is live. The structural face keeps this
      // independent of the host/client `Context.sessions` declaration split.
      const sessions = ctx.get('sessions') as CanvasSessionsLike | undefined
      const session = sessions?.binding(sessionId)?.session
      if (session === undefined) throw new Error('canvas: 会话不可用')
      return session
    }
    const remoteOf = (): CanvasRemoteNamespaceLike => {
      const remote = ctx.get('remote') as CanvasRemoteLike | undefined
      if (remote === undefined) throw new Error('canvas: 写回通道不可用')
      return remote.canvas
    }
    const unwrap = <T>(result: CanvasRemoteResult<T>, verb: string): T => {
      if (!result.ok) throw new Error(result.error?.message ?? `canvas: ${verb} 失败`)
      return result.value!
    }
    return {
      loadImage: async (attachmentId: string): Promise<string> => {
        const session = sessionOf()
        const result = await session.readAttachment(attachmentId)
        if (!result.ok) throw new Error(`${result.error?.code ?? 'error'}: ${result.error?.message ?? ''}`)
        const bytes = Uint8Array.from(result.value!.data)
        return URL.createObjectURL(new Blob([bytes.buffer], { type: result.value!.attachment.mediaType }))
      },
      ask: async (text: string): Promise<void> => {
        const session = sessionOf()
        await session.prompt([{ type: 'text', text }], 'queue')
      },
      addNode: async (request: CanvasAddNodeRequest): Promise<CanvasState> =>
        unwrap(await remoteOf().addNode(sessionId, request), 'addNode'),
      removeNode: async (nodeId: string): Promise<CanvasState> =>
        unwrap(await remoteOf().removeNode(sessionId, nodeId), 'removeNode'),
      updateNode: async (nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasState> =>
        unwrap(await remoteOf().updateNode(sessionId, nodeId, patch), 'updateNode'),
      moveNode: async (nodeId: string, x: number, y: number): Promise<CanvasState> =>
        unwrap(await remoteOf().moveNode(sessionId, nodeId, x, y), 'moveNode'),
      link: async (request: CanvasLinkRequest): Promise<CanvasState> =>
        unwrap(await remoteOf().link(sessionId, request), 'link'),
    }
  }
}

/**
 * Register the browser half: the right-Sidebar tab type and its body, the
 * Session-header way in, the Conversation view tab it is migrating from, and the
 * write-back Remote mount (the generated `canvas` namespace contribution).
 * @param ctx - client root context carrying the slots and the Session seat.
 */
export function apply(ctx: ClientContext): void {
  const face = createCanvasFace(ctx)

  // --- write-back Remote mount -------------------------------------------------
  // Optional by construction: if the Gateway's `remote` carrier is not mounted
  // (a composition without api-gateway), the canvas stays read-only instead of
  // hanging the whole plugin. The generated contribution is a pure value, so
  // mounting it here wires `ctx.remote.canvas` for every subsequent caller.
  ctx.inject(['remote'], (remoteCtx) => {
    const remote = remoteCtx.get('remote') as CanvasRemoteLike | undefined
    if (remote !== undefined) {
      void remote.$mount(canvasRemote).catch((error: unknown) => {
        console.error('[ldd-canvas] Remote mount failed:', error)
      })
    }
  })

  // --- right Sidebar: the canvas as a page-type tab (primary home) -----------
  // Optional by construction: `ctx.inject` waits only for this slice, so a
  // composition without the right Sidebar still gets the Conversation tab below.
  ctx.inject(['sidebarRightTabs', 'sidebarRight'], (sidebarCtx) => {
    // No `patterns` = a page type, opened by kind. No `guide` entry on purpose —
    // see this module's header comment.
    sidebarCtx.effect(
      () => sidebarCtx.sidebarRightTabs.register({
        id: CANVAS_ID,
        kind: CANVAS_KIND,
        title: () => '画布',
      }),
      'ldd-canvas: right-sidebar tab type',
    )

    sidebarCtx.slots.inject('sidebar.right.pane.tab', () => sidebarCtx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: CANVAS_ID,
      inject: face,
    }, CanvasView))

    // The always-mounted way in: one utility button in the Session header.
    sidebarCtx.slots.inject('conversation.session.header.utilities', () => sidebarCtx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'canvas-panel',
      order: 30,
      inject: () => ({ open: () => { sidebarCtx.sidebarRight.openTab(CANVAS_KIND) } }),
    }, CanvasPanelButton))
  })

  // --- Conversation view tab (transition fallback; delete when settled) ------
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: CANVAS_KIND,
    order: 20,
    label: () => '画布',
    inject: face,
  }, CanvasView))
}

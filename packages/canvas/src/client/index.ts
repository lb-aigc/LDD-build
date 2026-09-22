/**
 * @ldd/dsh-canvas — Browser half.
 *
 * The canvas lives in ONE seat — the right Sidebar, as a page-type tab
 * (`kind: 'canvas'`) — fed by the ONE host-side truth (`useProjection('canvas')`,
 * which folds the durable `canvas/state` events). The registration uses the
 * stock public two-stage path: `ctx.sidebarRightTabs.register` declares the tab
 * type, the keyed `sidebar.right.pane.tab` seat hosts its body. That is the same
 * path `ui-sidebar-files` and `ui-sidebar-documentpreview` take, so it costs zero
 * upstream patches. It deliberately claims NO guide entry: the shipped guide
 * draws its own page whenever more than one entry is registered, which would
 * turn the strip's add control from "open Files" into "open the guide". The way
 * in is the always-mounted 「画布」 utility in the Session header below.
 *
 * The seat is session-scoped, so the framework hands the body `useProjection`
 * and `sessionId`. The injected face carries the image loader, the one-shot
 * agent prompt, the write-back verbs (the six typert Remote methods of
 * {@link CanvasService}, mounted from the generated `@ldd/dsh-canvas/remote`
 * contribution and called directly with the session id — the same direct shape
 * `session-controller` uses), AND the file-upload entry (`pickFilesAndUpload`).
 * Every write lands as a durable `canvas/state` event on the Host, so the
 * projection re-renders from the SAME mirror the `canvas_*` tools mutate.
 *
 * The right-Sidebar services are taken through `ctx.inject` rather than the
 * top-level `inject` list: the canvas has to keep working in a composition
 * without the right Sidebar, and a missing optional service must not take the
 * canvas down with it. The host half uses the same idiom for its optional
 * `sessionProjections`.
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
// Type-only: the 'conversation.session.header.utilities' SlotMap row (declared
// by ui-conversation) must be in the program for the header-button register call.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useProjection/sessionId seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ctx.sidebarRight / ctx.sidebarRightTabs and the keyed
// sidebar.right.pane.tab seat declaration.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { CanvasState } from '../model.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasSaveAssetRequest, CanvasSaveAssetValue, CanvasUpdateNodeRequest } from '../types.ts'
import { CanvasView } from './CanvasView.tsx'
import type { CanvasUploadedAsset } from './CanvasView.tsx'
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
  saveAsset(sessionId: string, request: CanvasSaveAssetRequest): Promise<CanvasRemoteResult<CanvasSaveAssetValue>>
}

/** The Remote carrier as this package reaches it (mount + the canvas namespace). */
interface CanvasRemoteLike {
  $mount(contribution: unknown): Promise<unknown>
  canvas: CanvasRemoteNamespaceLike
  /** Session list (session-controller's remote) to resolve a session's workspace cwd. */
  session?: {
    list(request: Record<string, never>): Promise<{
      ok: boolean
      value: { items: Array<{ sessionId: SessionId; cwd?: string }> }
    }>
  }
}

/** Local structural copy of the main-process import result (no apps/desktop edge). */
interface ImportFileResultLike {
  readonly imported: boolean
  readonly relativePath: string
  readonly kind: 'video' | 'image' | 'document' | 'text' | 'other'
}

declare global {
  interface Window {
    readonly ldd?: {
      importFile(data: ArrayBuffer, fileName: string, workspacePath: string): Promise<ImportFileResultLike>
    }
  }
}

/** Extensions mapped to the three canvas media kinds (audio is NOT in the shell's kind vocabulary). */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma'])

/** Map one uploaded file name to a canvas media kind, or undefined when unsupported. */
function mediaKindOf(fileName: string): 'image' | 'video' | 'music' | undefined {
  const dot = fileName.lastIndexOf('.')
  const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'music'
  return undefined
}

/** Image MIME types the attachment store's `saveImage` accepts (its mediaTypes
 *  whitelist is exactly png/jpeg/webp/gif). `.bmp` is NOT normalizable, so it
 *  maps to undefined and the upload is skipped. */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Map one image file name to its accepted MIME type, or undefined when not. */
function imageMediaTypeOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.')
  const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase()
  return IMAGE_MIME[ext]
}

/** Read one File into a canonical base64 string (data-URL prefix stripped). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('canvas: 文件读取失败'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('canvas: 文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/** Open the native file picker and resolve the chosen files (empty on cancel). */
function openFilePicker(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.hidden = true
    let settled = false
    input.onchange = () => {
      settled = true
      const files = Array.from(input.files ?? [])
      input.remove()
      resolve(files)
    }
    const onFocus = (): void => {
      window.removeEventListener('focus', onFocus)
      window.setTimeout(() => {
        if (!settled) {
          settled = true
          input.remove()
          resolve([])
        }
      }, 300)
    }
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
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

/** Last `$mount` failure (or null), surfaced so the canvas can explain a missing
 *  `remote.canvas` namespace instead of throwing a bare `TypeError`. */
let mountFailure: string | null = null

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
      if (remote === undefined) throw new Error('canvas: 写回通道不可用（remote 服务未挂载）')
      const canvas = remote.canvas
      if (canvas === undefined) {
        throw new Error(`canvas: 写回通道不可用（remote.canvas 命名空间未挂载${mountFailure === null ? '' : `，mount 失败：${mountFailure}`}）`)
      }
      return canvas
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
      pickFiles: async (): Promise<File[]> => openFilePicker(),
      uploadFiles: async (files: File[]): Promise<CanvasUploadedAsset[]> => {
        if (files.length === 0) return []
        // Resolve the session workspace cwd once (needed for verbatim video/audio
        // import so the agent's tools can read them by path).
        let cwd: string | undefined
        const remote = ctx.get('remote') as CanvasRemoteLike | undefined
        const listed = await remote?.session?.list({})
        cwd = listed?.ok === true
          ? listed.value.items.find((item) => item.sessionId === sessionId)?.cwd
          : undefined
        const assets: CanvasUploadedAsset[] = []
        for (const file of files) {
          const kind = mediaKindOf(file.name)
          if (kind === undefined) continue
          if (kind === 'image') {
            // Image → durable normalized attachment (renders on the card).
            const mediaType = imageMediaTypeOf(file.name)
            if (mediaType === undefined) continue
            const dataBase64 = await fileToBase64(file)
            const saved = unwrap(await remoteOf().saveAsset(sessionId, {
              kind: 'image', name: file.name, mediaType, dataBase64,
            }), 'saveAsset')
            assets.push({
              name: file.name, kind, attachmentId: saved.attachmentId,
              ...(saved.width === undefined ? {} : { width: saved.width }),
              ...(saved.height === undefined ? {} : { height: saved.height }),
            })
            continue
          }
          // video/audio → verbatim workspace file (agent tools read the path).
          const ldd = window.ldd
          if (ldd === undefined) throw new Error('canvas: 当前环境不支持文件上传')
          if (cwd === undefined) throw new Error('canvas: 当前会话无工作区目录，无法上传文件')
          const data = await file.arrayBuffer()
          const res = await ldd.importFile(data, file.name, cwd)
          if (res.imported) assets.push({ name: file.name, kind })
        }
        return assets
      },
    }
  }
}

/**
 * Register the browser half: the right-Sidebar tab type and its body, the
 * Session-header way in, and the write-back Remote mount (the generated
 * `canvas` namespace contribution).
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
      void remote.$mount(canvasRemote).then(() => {
        mountFailure = null
      }).catch((error: unknown) => {
        mountFailure = error instanceof Error ? error.message : String(error)
        console.error('[ldd-canvas] Remote mount failed:', error)
      })
    } else {
      mountFailure = 'remote 服务未就绪（api-gateway client 未装配）'
    }
  })

  // --- right Sidebar: the canvas as a page-type tab (the only seat) --------
  // Optional by construction: `ctx.inject` waits only for this slice, so a
  // composition without the right Sidebar simply has no canvas tab.
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
}

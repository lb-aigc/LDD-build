/**
 * @ldd/dsh-canvas — Browser half. Registers the canvas as a third conversation
 * view tab (beside 对话/轨迹), reading the canvas state through the standard
 * `useProjection('canvas')` seat and resolving image-node attachments through
 * the session's `readAttachment` face. Zero upstream patches: `conversation.view`
 * is the stock list slot (same seam ui-trajectory rides for the 轨迹 tab).
 *
 * The sessions service is read through `ctx.get('sessions')` with a minimal
 * STRUCTURAL face (not `ctx.sessions.<method>`). This package's single tsconfig
 * compiles host + client halves together, and the host half imports
 * `@deepseek-ai/dsh-session` (declaring `Context.sessions: SessionStore`) while
 * the client half imports the runtime (declaring `Context.sessions: ISessions`);
 * a direct `ctx.sessions` property access would surface that conflict as
 * TS2339. `ctx.get` sidesteps it (same idiom as generate's `SessionsLike`).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation)
// must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CanvasState } from '../model.ts'
import { CanvasView } from './CanvasView.tsx'

/** Structural read face of the runtime's `readAttachment` (brand-free). */
interface CanvasSessionLike {
  readAttachment(attachmentId: string): Promise<{
    ok: boolean
    error?: { code: string; message: string }
    value?: { attachment: { mediaType: string }; data: Uint8Array }
  }>
}

/** Structural read face of the runtime sessions service (binding lookup). */
interface CanvasSessionsLike {
  binding(id: SessionId): { session?: CanvasSessionLike } | undefined
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole per-session canvas (nodes + edges). */
    canvas: CanvasState
  }
}

export const inject = ['slots', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'canvas',
    order: 20,
    label: () => '画布',
    inject: (sessionId: SessionId) => ({
      loadImage: async (attachmentId: string): Promise<string> => {
        // Resolve lazily per call so a view mounted before the session bound
        // still loads once the binding is live. The structural face keeps this
        // independent of the host/client `Context.sessions` declaration split.
        const sessions = ctx.get('sessions') as CanvasSessionsLike | undefined
        const session = sessions?.binding(sessionId)?.session
        if (session === undefined) throw new Error('canvas: 会话不可用，无法解析图片')
        const result = await session.readAttachment(attachmentId)
        if (!result.ok) throw new Error(`${result.error?.code ?? 'error'}: ${result.error?.message ?? ''}`)
        const bytes = Uint8Array.from(result.value!.data)
        return URL.createObjectURL(new Blob([bytes.buffer], { type: result.value!.attachment.mediaType }))
      },
    }),
  }, CanvasView))
}

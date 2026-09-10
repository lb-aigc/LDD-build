/**
 * @ldd/dsh-canvas — Browser half. Registers the canvas as a third tab in the
 * conversation view ring (beside 对话/轨迹), reading the canvas state through
 * the standard `useProjection('canvas')` seat and resolving image-node
 * attachments through the session's `readAttachment` face — zero upstream
 * patches.
 */
import type { ClientContext, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the 'conversation.view' SlotMap row + ConvViewProps (declared by
// ui-conversation) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CanvasState } from '../model.ts'
import { CanvasView } from './CanvasView.tsx'

// The `readAttachment` argument is the branded `AttachmentIdType` (a unique-symbol
// brand, so it cannot be locally shimmed). Extract its type from the runtime
// SessionFace instead of importing `@deepseek-ai/dsh-attachment` — the import
// would add a dependency edge and re-trigger the pnpm-lockfile round-trip (same
// rationale as generate's `attach.ts` shim). At runtime it is a plain `sha256:` string.
type AttachmentIdParam = Parameters<SessionFace['readAttachment']>[0]

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
        // still loads once the binding is live.
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error('canvas: 会话不可用，无法解析图片')
        const result = await session.readAttachment(attachmentId as unknown as AttachmentIdParam)
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        const bytes = Uint8Array.from(result.value.data)
        return URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
      },
    }),
  }, CanvasView))
}

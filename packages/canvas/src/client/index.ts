/**
 * @ldd/dsh-canvas — Browser half. Registers the canvas as a third tab in the
 * conversation view ring (beside 对话/轨迹), reading the canvas state through
 * the standard `useProjection('canvas')` seat — zero upstream patches.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the 'conversation.view' SlotMap row + ConvViewProps (declared by
// ui-conversation) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: merges the canvas key into SessionProjectionMap for useProjection.
import type { CanvasState } from '../model.ts'
import { CanvasView } from './CanvasView.tsx'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole per-session canvas (nodes + edges). */
    canvas: CanvasState
  }
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'canvas',
    order: 20,
    label: () => '画布',
    inject: (_sessionId: SessionId) => ({}),
  }, CanvasView))
}

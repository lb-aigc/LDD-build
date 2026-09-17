/**
 * CanvasPanelButton: the always-mounted way into the right Sidebar's canvas tab.
 *
 * It rides the Session header's utilities list
 * (`conversation.session.header.utilities`, a list seat) instead of a guide
 * entry on purpose: the shipped guide opens its own page only while exactly one
 * entry is registered, so contributing one would turn the strip's add control
 * from "open Files" into "open the guide". A header utility leaves that control
 * alone AND renders for every Session, which is what this tab needs to be
 * reachable at all.
 *
 * It renders one icon button and calls `ctx.sidebarRight.openTab('canvas')`
 * through its injected face. Page tabs deduplicate within a pane, so pressing it
 * while the canvas is already open focuses that tab instead of duplicating it.
 *
 * Nothing here watches the canvas projection: the button never opens, closes or
 * focuses anything on its own. The panel moves only when the user presses it, so
 * the same prompt cannot produce a different canvas depending on panel state.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** The face this entry injects: one way in, nothing to read back. */
export interface CanvasPanelButtonInjected {
  /** Open the canvas page tab in the active pane, or focus it when already open. */
  readonly open: () => void
}

/** Button props: the standard Session props plus the injected opener. */
export type CanvasPanelButtonProps = PropsRuntime<'conversation.session.header.utilities'> & CanvasPanelButtonInjected

/**
 * The header utility itself.
 * @param props - the injected opener; the standard Session props go unused.
 * @returns the canvas icon button.
 */
export function CanvasPanelButton({ open }: CanvasPanelButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="ldd-canvas-header-button"
      title="画布"
      aria-label="画布"
      onClick={open}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="5.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="5.5" height="2.5" rx="1" />
        <rect x="9" y="6.5" width="5.5" height="7" rx="1" />
        <rect x="1.5" y="8.5" width="5.5" height="5" rx="1" />
      </svg>
    </button>
  )
}

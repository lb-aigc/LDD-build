/**
 * Skill picker: an always-visible control in the composer tool row (the
 * `conversation.input.left` seat) that opens a small popover listing the
 * session's user-invocable skills and lands `/name ` into the draft on pick —
 * the same plain-text-reference the `/` source produces, so the Host's
 * pre-step boundary resolves it identically.
 *
 * Self-contained: the skill catalog shape is vendored (no dsh-api-remotes
 * edge) and styling is inline CSS, matching the generation cards' vendored
 * form controls.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Minimal skill catalog row (vendored; the wire type is `SkillEntry`). */
export interface SkillEntryLike {
  readonly name: string
  readonly description: string
  readonly modelInvocable: boolean
}

/** Business face injected by the slot registration (per-session listSkills). */
export interface SkillPickerFace {
  /** Resolve the session's user-invocable skill catalog (empty on failure). */
  listSkills: (signal?: AbortSignal) => Promise<readonly SkillEntryLike[]>
}

export type SkillPickerProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'generate'>
  & InjectFace<SkillPickerFace>

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  height: '24px',
  padding: '0 8px',
  fontSize: '12px',
  fontWeight: 600,
  border: '1px solid var(--dsh-border, #d0d5dd)',
  borderRadius: '6px',
  background: 'var(--dsh-bg-field, #fff)',
  color: 'var(--dsh-fg, #101828)',
  cursor: 'pointer',
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 'calc(100% + 6px)',
  width: '260px',
  maxHeight: '320px',
  overflowY: 'auto',
  padding: '4px',
  border: '1px solid var(--dsh-border, #d0d5dd)',
  borderRadius: '8px',
  background: 'var(--dsh-bg-field, #fff)',
  boxShadow: '0 8px 24px rgba(16, 24, 40, 0.16)',
  zIndex: 40,
}

const itemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px',
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  cursor: 'pointer',
}

const nameStyle: CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--dsh-fg, #101828)',
}

const descStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: 'var(--dsh-fg-muted, #475467)',
  marginTop: '2px',
}

const hintStyle: CSSProperties = {
  padding: '8px',
  fontSize: '12px',
  color: 'var(--dsh-fg-muted, #475467)',
}

/**
 * Render the skill button + popover. Reads the draft through `useInput`,
 * writes `/name ` through `inputActions.setDraft`, and lists the catalog
 * through the injected `listSkills` (bound to the slot's session id).
 */
export function SkillPicker({ useInput, inputActions, listSkills, t }: SkillPickerProps) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<readonly SkillEntryLike[]>([])
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside pointer-down (the popover floats above the tool row).
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const node = event.target as Node | null
      if (rootRef.current !== null && !rootRef.current.contains(node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setEntries(await listSkills())
    } catch {
      // A failed catalog read degrades to an empty list; the button stays usable.
    }
    setLoading(false)
  }

  const toggle = (): void => {
    setOpen(value => !value)
    if (!open) void load()
  }

  const pick = (name: string): void => {
    const draft = useInput(s => s.draft) ?? ''
    const separator = draft !== '' && !draft.endsWith(' ') ? ' ' : ''
    inputActions.setDraft(`${draft}${separator}/${name} `)
    setOpen(false)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button type="button" style={buttonStyle} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        {t('skillPicker.label')}
      </button>
      {open ? (
        <div style={panelStyle} role="menu">
          {loading ? (
            <div style={hintStyle}>{t('skillPicker.loading')}</div>
          ) : entries.length === 0 ? (
            <div style={hintStyle}>{t('skillPicker.empty')}</div>
          ) : entries.map(skill => (
            <button key={skill.name} type="button" role="menuitem" style={itemStyle} onClick={() => pick(skill.name)}>
              <span style={nameStyle}>{skill.name}</span>
              <span style={descStyle}>
                {skill.modelInvocable ? skill.description : `${t('skillPicker.userOnly')} · ${skill.description}`}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

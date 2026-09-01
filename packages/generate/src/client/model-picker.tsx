/**
 * Composer generation-model picker: an icon + current-model button in the
 * composer tool row (the `conversation.input.generate-model` seat). Clicking
 * opens a dropdown of every configured image model; picking one runs a
 * per-session temporary switch, and each row's "设为默认" action writes the
 * settings default. Self-contained (no ui-primitives import): the dropdown is
 * a plain absolutely-positioned list, mirroring the card's plain-React style.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelPickerFace } from './model-picker-controller.ts'
import type { GenerateLocaleKey } from './locales.ts'

export type GenerateModelPickerProps =
  PropsRuntime<'conversation.input.generate-model'>
  & PropsLocale<'generate'>
  & InjectFace<ModelPickerFace>

/** A small image/generate glyph, currentColor so it tints with the button. */
function GenerateGlyph(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" />
      <path d="M3 12.5L6.2 9.3L9 12.1L11 10.1L13 12.1" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 8px',
  fontSize: '12px',
  border: '1px solid var(--dsh-border, #d0d5dd)',
  borderRadius: '6px',
  background: 'var(--dsh-bg-field, #fff)',
  color: 'var(--dsh-fg, #101828)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  maxWidth: '220px',
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  minWidth: '240px',
  maxWidth: '320px',
  background: 'var(--dsh-bg-field, #fff)',
  border: '1px solid var(--dsh-border, #e4e7ec)',
  borderRadius: '8px',
  boxShadow: '0 8px 24px rgba(16,24,40,0.14)',
  padding: '4px',
  zIndex: 30,
}

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  width: '100%',
  padding: '7px 8px',
  fontSize: '12px',
  textAlign: 'left',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  borderRadius: '5px',
  color: 'var(--dsh-fg, #101828)',
}

export function GenerateModelPicker(props: GenerateModelPickerProps): ReactElement | null {
  const state = props.useModelPicker((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  // Local "currently active" key: follows the default, then flips on a
  // temporary select so the button reflects the session override immediately.
  const [currentKey, setCurrentKey] = useState<string | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  if (!state.available || state.models.length === 0) return null

  const activeKey = currentKey ?? state.defaultKey
  const active = state.models.find((m) => m.key === activeKey) ?? state.models.find((m) => m.isDefault) ?? state.models[0]

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        style={triggerStyle}
        aria-label={props.t('modelPicker.trigger')}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.locked}
        onClick={() => { setOpen(!open) }}
        onMouseDown={(event) => { event.preventDefault() }}
      >
        <GenerateGlyph />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{active?.label ?? ''}</span>
        <span aria-hidden style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
      </button>
      {open
        ? (
          <div role="listbox" style={menuStyle}>
            {state.models.map((model) => (
              <div
                key={model.key}
                role="option"
                aria-selected={model.key === activeKey}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <button
                  type="button"
                  style={{ ...itemStyle, background: model.key === activeKey ? 'var(--dsh-bg-hover, #f2f4f7)' : undefined }}
                  onClick={() => {
                    setCurrentKey(model.key)
                    setOpen(false)
                    props.select(model.key)
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.label}</span>
                  {model.isDefault
                    ? <span style={{ fontSize: '10px', color: 'var(--dsh-fg-muted, #667085)', flexShrink: 0 }}>{props.t('modelPicker.default')}</span>
                    : null}
                </button>
                <button
                  type="button"
                  title={props.t('modelPicker.setDefault')}
                  style={{
                    flexShrink: 0,
                    padding: '4px 6px',
                    fontSize: '10px',
                    border: model.isDefault ? '1px solid transparent' : '1px solid var(--dsh-border, #d0d5dd)',
                    borderRadius: '5px',
                    background: model.isDefault ? 'transparent' : 'transparent',
                    color: model.isDefault ? 'var(--dsh-fg-muted, #667085)' : 'var(--dsh-fg-muted, #475467)',
                    cursor: model.isDefault ? 'default' : 'pointer',
                    opacity: model.isDefault ? 0.5 : 1,
                  }}
                  disabled={model.isDefault}
                  onClick={() => {
                    setCurrentKey(model.key)
                    setOpen(false)
                    props.setDefault(model.key)
                  }}
                >
                  {model.isDefault ? '✓' : props.t('modelPicker.setDefault')}
                </button>
              </div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}

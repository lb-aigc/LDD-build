/**
 * Composer generation-model picker: a chip in the composer tool row (the
 * `conversation.input.generate-model` seat) that opens a harness-native `Menu`
 * listing EVERY configured image model. Picking one runs a per-session
 * temporary switch; a trailing "set default" row persists the current pick.
 * Styled to match the sibling PermissionSelect / ModelSelect triggers (same
 * 28px chip, `--dsw-*` tokens, chevron rotation), so it reads as part of the
 * composer rather than a bolted-on control.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelPickerFace } from './model-picker-controller.ts'
import type { GenerateLocaleKey } from './locales.ts'
import css from './model-picker.module.css'

export type GenerateModelPickerProps =
  PropsRuntime<'conversation.input.generate-model'>
  & PropsLocale<'generate'>
  & InjectFace<ModelPickerFace>

/** Reserved menu id for the "set as default" action row. */
const SET_DEFAULT_ID = '__set-default'

/** A small image/generate glyph, currentColor so trigger and rows tint it. */
function generateGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" />
      <path d="M3 12.5L6.2 9.3L9 12.1L11 10.1L13 12.1" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** Pin glyph for the "set default" row. */
function pinGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9.5 2.5L13.5 6.5L10 7.5L8.5 13.5L5 8.5L2.5 11L2 10.5L5 7.5L5 2.5L9.5 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function GenerateModelPicker(props: GenerateModelPickerProps): ReactNode | null {
  const state = props.useModelPicker((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  // The session's active pick: follows the default until a temporary switch.
  const [currentKey, setCurrentKey] = useState<string | undefined>(undefined)

  // A new session resets the temporary override back to that session's default.
  useEffect(() => {
    setCurrentKey(undefined)
  }, [props.sessionId])

  if (!state.available || state.models.length === 0) return null

  const activeKey = currentKey ?? state.defaultKey
  const active = state.models.find((m) => m.key === activeKey)
    ?? state.models.find((m) => m.isDefault)
    ?? state.models[0]

  const items: MenuEntry[] = [
    ...state.models.map((model) => ({
      id: model.key,
      label: model.label,
      icon: generateGlyph(),
    })),
    { type: 'separator', id: 'picker-separator' },
    {
      id: SET_DEFAULT_ID,
      label: props.t('modelPicker.setDefault'),
      icon: pinGlyph(),
    },
  ]

  const onSelect = (id: string): void => {
    if (id === SET_DEFAULT_ID) {
      // Persist whichever model is currently active as the settings default.
      props.setDefault(activeKey)
      return
    }
    setCurrentKey(id)
    props.select(id)
  }

  return (
    <Menu
      open={open}
      items={items}
      selectedId={activeKey}
      onSelect={onSelect}
      onClose={() => { setOpen(false) }}
      side="top"
      anchor={
        <button
          type="button"
          className={css.trigger}
          aria-label={props.t('modelPicker.trigger')}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={props.locked}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.triggerIcon} aria-hidden>{generateGlyph()}</span>
          <span className={css.triggerLabel}>{active?.label ?? ''}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}

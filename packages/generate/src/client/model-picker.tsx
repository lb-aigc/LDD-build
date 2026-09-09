/**
 * Composer generation-model picker: a chip in the composer tool row (the
 * `conversation.input.generate-model` seat) that opens a harness-native `Menu`
 * grouped into 图片模型 / 视频模型 / 音乐模型. Picking one runs a per-session
 * temporary switch for THAT modality (no "set default" — the model choice IS
 * the pick). Styled to match the sibling PermissionSelect / ModelSelect
 * triggers (same 28px chip, `--dsw-*` tokens, chevron rotation).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelPickerFace, GenerationKind } from './model-picker-controller.ts'
import type { GenerateLocaleKey } from './locales.ts'
import css from './model-picker.module.css'

export type GenerateModelPickerProps =
  PropsRuntime<'conversation.input.generate-model'>
  & PropsLocale<'generate'>
  & InjectFace<ModelPickerFace>

/** A small image glyph, currentColor so trigger and rows tint it. */
function imageGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" />
      <path d="M3 12.5L6.2 9.3L9 12.1L11 10.1L13 12.1" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** A small video glyph. */
function videoGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="3" width="9" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11.5 6.5L14 4.8V11.2L11.5 9.5V6.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** A small music glyph. */
function musicGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 12.5V4L13 2.5V11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="4.5" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function kindGlyph(kind: GenerationKind): ReactNode {
  if (kind === 'video') return videoGlyph()
  if (kind === 'music') return musicGlyph()
  return imageGlyph()
}

const SEP = '::'
const itemId = (kind: GenerationKind, key: string): string => `${kind}${SEP}${key}`

export function GenerateModelPicker(props: GenerateModelPickerProps): ReactNode | null {
  const state = props.useModelPicker((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  // Per-session temporary override, keyed by SessionId so a pick survives
  // switching to another session and back. A single flat `currentKeys` reset on
  // every session switch was the bug that made the previous session's pick look
  // "changed" — the button fell back to the global default on return.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Partial<Record<GenerationKind, string>>>>(
    () => new Map(),
  )
  const currentKeys = overrides.get(props.sessionId) ?? {}

  if (!state.available || state.groups.every((group) => group.models.length === 0)) return null

  const items: MenuEntry[] = []
  for (const group of state.groups) {
    if (group.models.length === 0) continue
    items.push({ type: 'label', id: `label-${group.kind}`, text: groupLabel(props, group.kind) })
    for (const model of group.models) {
      items.push({
        id: itemId(group.kind, model.key),
        label: model.label,
        icon: kindGlyph(group.kind),
      })
    }
  }

  const selectedIds = state.groups
    .filter((group) => group.models.length > 0)
    .map((group) => itemId(group.kind, currentKeys[group.kind] ?? group.defaultKey))

  const onSelect = (id: string): void => {
    const sep = id.indexOf(SEP)
    if (sep < 0) return
    const kind = id.slice(0, sep) as GenerationKind
    const key = id.slice(sep + SEP.length)
    setOverrides((prev) => {
      const next = new Map(prev)
      next.set(props.sessionId, { ...(next.get(props.sessionId) ?? {}), [kind]: key })
      return next
    })
    props.select(kind, key)
  }

  return (
    <Menu
      open={open}
      items={items}
      selectedIds={selectedIds}
      onSelect={onSelect}
      onClose={() => { setOpen(false) }}
      side="top"
      portal
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
          <span className={css.triggerIcon} aria-hidden>{imageGlyph()}</span>
          <span className={css.triggerLabel}>{props.t('modelPicker.trigger')}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}

function groupLabel(props: GenerateModelPickerProps, kind: GenerationKind): string {
  if (kind === 'video') return props.t('modelPicker.videoGroup')
  if (kind === 'music') return props.t('modelPicker.musicGroup')
  return props.t('modelPicker.imageGroup')
}

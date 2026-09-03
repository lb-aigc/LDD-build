/**
 * One generation-settings card ("生图模型" / "生视频模型" / "音乐模型")
 * rendering a KEY list — one credential input per relay. Model choice is
 * built-in and lives in the composer picker, NOT here. Self-contained
 * controls (the reference package ships only types), so the markup is plain
 * React.
 */
import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GenerationCardFace } from './controller.ts'
import type { GenerateLocaleKey } from './locales.ts'

export type GenerationCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'generate'>
  & InjectFace<GenerationCardFace>

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid var(--dsh-border, #d0d5dd)',
  borderRadius: '6px',
  background: 'var(--dsh-bg-field, #fff)',
  color: 'var(--dsh-fg, #101828)',
}

const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '12px',
  fontWeight: 600,
  marginBottom: '4px',
  color: 'var(--dsh-fg-muted, #475467)',
}

const statusStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  padding: '1px 8px',
  borderRadius: '10px',
}

function KeyField(props: {
  label: string
  configured: boolean
  value: string
  disabled: boolean
  placeholder: string
  configuredText: string
  unconfiguredText: string
  onEdit: (text: string) => void
}): ReactElement {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>
        <span>{props.label}</span>
        <span style={{
          ...statusStyle,
          color: props.configured ? '#067647' : '#475467',
          background: props.configured ? 'var(--dsh-bg-success, #ecfdf3)' : 'var(--dsh-bg-field, #f2f4f7)',
        }}>
          {props.configured ? props.configuredText : props.unconfiguredText}
        </span>
      </label>
      <input
        type="password"
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        autoComplete="off"
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
    </div>
  )
}

export function GenerateSettingsCard(props: GenerationCardProps): ReactElement | null {
  const { t } = props
  const state = props.useGenerationCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null

  const title = state.kind === 'image' ? t('imageTitle') : state.kind === 'video' ? t('videoTitle') : t('musicTitle')
  const disabled = !state.writable
  const canSave = state.dirty && !state.saving && state.writable

  return (
    <li style={{ listStyle: 'none', border: '1px solid var(--dsh-border, #e4e7ec)', borderRadius: '8px', marginBottom: '8px', background: 'var(--dsh-bg-card, #fff)' }}>
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: 'var(--dsh-fg, #101828)' }}
      >
        <span>{title}</span>
        <span style={{ fontSize: '12px', color: state.dirty ? '#b54708' : 'var(--dsh-fg-muted, #667085)' }}>
          {state.dirty ? t('unsaved') : '⌄'}
        </span>
      </button>
      {open
        ? (
          <div style={{ padding: '0 16px 16px' }}>
            {!state.writable
              ? <p style={{ fontSize: '12px', color: 'var(--dsh-fg-muted, #667085)' }}>{t('readOnly')}</p>
              : <p style={{ fontSize: '12px', color: 'var(--dsh-fg-muted, #667085)', margin: '0 0 12px' }}>{t('keyListHint')}</p>}
            {state.keys.map((key) => (
              <KeyField
                key={key.ref}
                label={key.label}
                configured={key.configured}
                value={key.value}
                disabled={disabled}
                placeholder={t('keyPlaceholder')}
                configuredText={t('configured')}
                unconfiguredText={t('unconfigured')}
                onEdit={(text) => { props.setKey(key.ref, text) }}
              />
            ))}
            {state.failed
              ? <p style={{ fontSize: '12px', color: '#b42318' }}>{t('saveFailed')}</p>
              : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button type="button" onClick={props.discard} disabled={!state.dirty || state.saving} style={{ padding: '6px 12px', fontSize: '13px', border: '1px solid var(--dsh-border, #d0d5dd)', borderRadius: '6px', background: 'transparent', cursor: 'pointer' }}>
                {t('discard')}
              </button>
              <button type="button" onClick={props.save} disabled={!canSave} style={{ padding: '6px 14px', fontSize: '13px', border: 'none', borderRadius: '6px', background: 'var(--dsh-accent, #175cd3)', color: '#fff', cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5 }}>
                {t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}

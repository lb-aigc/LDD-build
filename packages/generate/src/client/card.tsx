/**
 * One generation-settings card ("生图模型" / "生视频模型"). Renders the
 * provider/model/endpoint fields plus the write-only API key, with a staged
 * save/discard footer. Self-contained controls (the reference package ships
 * only types), so the markup is plain React inputs.
 */
import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GenerationCardFace } from './controller.ts'

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
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  marginBottom: '4px',
  color: 'var(--dsh-fg-muted, #475467)',
}

function Field(props: {
  label: string
  hint?: string
  value: string
  disabled: boolean
  type?: string
  onEdit: (text: string) => void
}): ReactElement {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>{props.label}</label>
      <input
        type={props.type ?? 'text'}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.hint}
        onChange={(event) => { props.onEdit(event.currentTarget.value) }}
      />
    </div>
  )
}

export function GenerateSettingsCard(props: GenerationCardProps): ReactElement | null {
  const { t } = props
  const state = props.useGenerationCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null

  const title = state.kind === 'image' ? t('imageTitle') : t('videoTitle')
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
              : null}
            <Field label={t('provider')} hint={t('providerHint')} value={state.provider.text} disabled={disabled} onEdit={(text) => { props.edit('provider', text) }} />
            <Field label={t('model')} hint={t('modelHint')} value={state.model.text} disabled={disabled} onEdit={(text) => { props.edit('model', text) }} />
            <Field label={t('baseURL')} hint={t('baseURLHint')} value={state.baseURL.text} disabled={disabled} onEdit={(text) => { props.edit('baseURL', text) }} />
            <Field label={t('apiKeyEnv')} hint={t('apiKeyEnvHint')} value={state.apiKeyEnv.text} disabled={disabled} onEdit={(text) => { props.edit('apiKeyEnv', text) }} />
            <Field label={t('apiKey')} hint={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')} value={state.apiKey.text} disabled={!state.apiKeyWritable} type="password" onEdit={(text) => { props.edit('apiKey', text) }} />
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

/**
 * One generation-settings card ("生图模型" / "生视频模型") rendering a MODEL
 * LIST: each row picks a provider preset (dropdown) or `custom` (revealing
 * protocol + endpoint), carries a default radio, and can be removed. A footer
 * adds rows and saves/discards the whole list. Self-contained controls (the
 * reference package ships only types), so the markup is plain React.
 */
import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditableModelField, GenerationCardFace, ModelRow } from './controller.ts'
import type { GenerateLocaleKey } from './locales.ts'
import { CUSTOM_PROVIDER_ID, IMAGE_PRESETS, VIDEO_PRESETS, routeKeyOf } from './presets.ts'
import type { ClientPreset } from './presets.ts'

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
  type?: 'text' | 'password'
  onEdit: (text: string) => void
}): ReactElement {
  return (
    <div style={{ marginBottom: '10px' }}>
      <label style={labelStyle}>{props.label}</label>
      <input
        type={props.type ?? 'text'}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.hint}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
    </div>
  )
}

function ModelRow(props: {
  model: ModelRow
  index: number
  isDefault: boolean
  disabled: boolean
  presets: readonly ClientPreset[]
  t: (key: GenerateLocaleKey) => string
  onEditModel: (index: number, field: EditableModelField, text: string) => void
  onRemove: (index: number) => void
  onSetDefault: (index: number) => void
  onSetApiKey: (index: number, text: string) => void
}): ReactElement {
  const { model, index, isDefault, disabled, presets, t } = props
  const isCustom = model.provider === CUSTOM_PROVIDER_ID
  const suggested = presets.find((preset) => preset.id === model.provider)?.suggestedModels ?? []
  const modelListId = `generate-model-${model.uid}`
  return (
    <div style={{ border: '1px solid var(--dsh-border, #e4e7ec)', borderRadius: '6px', padding: '12px', marginBottom: '10px', background: 'var(--dsh-bg-field, #fff)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', color: 'var(--dsh-fg, #101828)' }}>
          <input
            type="radio"
            name="generate-default"
            checked={isDefault}
            disabled={disabled}
            onChange={() => { props.onSetDefault(index) }}
          />
          <span>{t('defaultLabel')}</span>
        </label>
        <select
          style={{ ...inputStyle, flex: 1 }}
          value={model.provider}
          disabled={disabled}
          onChange={(event) => { props.onEditModel(index, 'provider', event.target.value) }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
          <option value={CUSTOM_PROVIDER_ID}>{t('custom')}</option>
        </select>
        <button
          type="button"
          onClick={() => { props.onRemove(index) }}
          disabled={disabled}
          style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--dsh-border, #d0d5dd)', borderRadius: '6px', background: 'transparent', cursor: disabled ? 'default' : 'pointer', color: '#b42318' }}
        >
          {t('remove')}
        </button>
      </div>
      {isCustom
        ? <Field label={t('protocol')} hint={t('protocolHint')} value={model.protocol} disabled={disabled} onEdit={(text) => { props.onEditModel(index, 'protocol', text) }} />
        : null}
      {isCustom
        ? <Field label={t('baseURL')} hint={t('baseURLHint')} value={model.baseURL} disabled={disabled} onEdit={(text) => { props.onEditModel(index, 'baseURL', text) }} />
        : null}
      {suggested.length > 0
        ? (
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>{t('model')}</label>
            <input
              type="text"
              style={inputStyle}
              value={model.model}
              disabled={disabled}
              placeholder={t('modelHint')}
              list={modelListId}
              onChange={(event) => { props.onEditModel(index, 'model', event.target.value) }}
            />
            <datalist id={modelListId}>
              {suggested.map((option) => <option key={option} value={option} />)}
            </datalist>
          </div>
        )
        : <Field label={t('model')} hint={t('modelHint')} value={model.model} disabled={disabled} onEdit={(text) => { props.onEditModel(index, 'model', text) }} />}
      <Field label={t('apiKeyEnv')} hint={t('apiKeyEnvHint')} value={model.apiKeyEnv} disabled={disabled} onEdit={(text) => { props.onEditModel(index, 'apiKeyEnv', text) }} />
      <Field label={t('apiKey')} hint={t('apiKeyHint')} value={model.apiKeyText} disabled={disabled} type="password" onEdit={(text) => { props.onSetApiKey(index, text) }} />
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
  const presets = state.kind === 'image' ? IMAGE_PRESETS : VIDEO_PRESETS

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
            {state.models.map((model, index) => (
              <ModelRow
                key={model.uid}
                model={model}
                index={index}
                isDefault={routeKeyOf(state.models, index) === state.defaultKey}
                disabled={disabled}
                presets={presets}
                t={t}
                onEditModel={props.editModel}
                onRemove={props.removeModel}
                onSetDefault={props.setDefault}
                onSetApiKey={props.setApiKey}
              />
            ))}
            <button
              type="button"
              onClick={props.addModel}
              disabled={disabled}
              style={{ width: '100%', padding: '8px', fontSize: '13px', border: '1px dashed var(--dsh-border, #d0d5dd)', borderRadius: '6px', background: 'transparent', cursor: disabled ? 'default' : 'pointer', color: 'var(--dsh-fg-muted, #475467)' }}
            >
              {t('addModel')}
            </button>
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

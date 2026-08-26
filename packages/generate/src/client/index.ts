/**
 * Browser half of @ldd/dsh-generate: two settings cards ("生图模型" /
 * "生视频模型") on the Plugins settings page, one per generation namespace.
 *
 * The cards edit the `generate-image` / `generate-video` settings namespaces the
 * Host half registers, plus the API-key reference through the credentials
 * domain (the key literal never rides a response). Everything is self-contained:
 * the reference ui-settings-plugins package exports only types, so the form
 * model and controls below are vendored here rather than imported.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the conversation slot declarations (conversation.input.left
// owner + the session standard kit `useInput`/`inputActions` merge) so the
// skill-picker registration typechecks with no runtime edge to ui-conversation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Slot + locale type declarations (settings.plugin.item, LocaleNamespaceMap).
import type {} from './slot-contract.ts'

import { GenerateSettingsCard } from './card.tsx'
import { GenerateSettingsController } from './controller.ts'
import { FileUpload } from './file-upload.tsx'
import { en, zh } from './locales.ts'
import { SkillPicker } from './skill-picker.tsx'

/** Namespace strings the Host half registers (must match src/settings.ts). */
export const IMAGE_NS = 'generate-image'
export const VIDEO_NS = 'generate-video'

const NS = 'generate'

export const inject = ['slots', 'locale', 'connection', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'generate: card dictionaries')

  const image = new GenerateSettingsController(
    ctx.settingsScope.bind({ namespace: IMAGE_NS }),
    api,
    'image',
  )
  const video = new GenerateSettingsController(
    ctx.settingsScope.bind({ namespace: VIDEO_NS }),
    api,
    'video',
  )

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: IMAGE_NS,
      locale: NS,
      inject: () => image.inject(),
    }, GenerateSettingsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: VIDEO_NS,
      locale: NS,
      inject: () => video.inject(),
    }, GenerateSettingsCard)
  })

  // Skill picker: an always-visible control in the composer tool row that lists
  // the session's skills and lands `/name ` into the draft on pick.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'skill-picker',
    order: 10,
    locale: NS,
    inject: (sessionId) => ({
      listSkills: async (signal?: AbortSignal) => {
        const { result } = await api.skills.list({ sessionId }, signal)
        return result.ok ? [...result.value.skills] : []
      },
    }),
  }, SkillPicker))

  // File upload: imports picked files into the session workspace through the
  // Electron main process so the agent can read them (analyze_video / read /
  // parsed Markdown). In a plain browser (no window.ldd) it reports failure.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'file-upload',
    order: 5,
    locale: NS,
    inject: (sessionId) => ({
      importFiles: async (files: readonly File[]): Promise<string> => {
        const ldd = window.ldd
        if (ldd === undefined) return t('fileUpload.failed')
        const { result } = await api.sessions.list({})
        const cwd = result.ok
          ? result.value.items.find(s => s.sessionId === sessionId)?.cwd
          : undefined
        if (cwd === undefined) return t('fileUpload.noWorkspace')
        const landed: string[] = []
        for (const file of files) {
          const data = await file.arrayBuffer()
          const res = await ldd.importFile(data, file.name, cwd)
          if (!res.imported) continue
          if (res.kind === 'document' && res.markdownPath !== undefined) {
            landed.push(`${file.name}→${res.markdownPath}`)
          } else {
            landed.push(res.relativePath)
          }
        }
        if (landed.length === 0) return t('fileUpload.failed')
        return `已上传到工作区：${landed.join('、')}`
      },
    }),
  }, FileUpload))
}

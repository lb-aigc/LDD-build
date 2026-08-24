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
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

import { GenerateSettingsCard } from './card.tsx'
import { GenerateSettingsController } from './controller.ts'
import { en, zh } from './locales.ts'

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
}

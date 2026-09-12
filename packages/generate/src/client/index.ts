/**
 * Browser half of @ldd/dsh-generate: three settings cards (生图模型 / 生视频
 * 模型 / 生音乐模型) on the Plugins settings page, one per generation namespace,
 * plus the composer generation-model picker seat and the file-upload command.
 *
 * The cards edit the `generate-image` / `generate-video` / `generate-music`
 * settings namespaces the Host half registers, plus the API-key reference
 * through the credentials domain (the key literal never rides a response).
 * Everything is self-contained: the reference ui-settings-plugins package
 * exports only types, so the form model and controls below are vendored here
 * rather than imported.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the remote RPC namespaces (ctx.remote.credentials / .session).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi) + contribution types.
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useProjection/sessionId seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Slot + locale type declarations (settings.plugin.item, conversation.input.generate-model, LocaleNamespaceMap).
import type {} from './slot-contract.ts'

import { GenerateSettingsCard } from './card.tsx'
import { GenerateSettingsController } from './controller.ts'
import { importWorkspaceFiles } from './file-import.ts'
import type { SessionsLike } from './file-import.ts'
import { en, zh } from './locales.ts'
import { GenerateModelPicker } from './model-picker.tsx'
import { ModelPickerController } from './model-picker-controller.ts'
import type { CommandableSessions } from './model-picker-controller.ts'

/** Namespace strings the Host half registers (must match src/settings.ts). */
export const IMAGE_NS = 'generate-image'
export const VIDEO_NS = 'generate-video'
export const MUSIC_NS = 'generate-music'

const NS = 'generate'

export const inject = ['slots', 'locale', 'remote', 'settingsScope', 'commandUi', 'sessions']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'generate: card dictionaries')

  const image = new GenerateSettingsController(
    ctx.settingsScope.bind({ namespace: IMAGE_NS }),
    ctx,
    'image',
  )
  const video = new GenerateSettingsController(
    ctx.settingsScope.bind({ namespace: VIDEO_NS }),
    ctx,
    'video',
  )
  const music = new GenerateSettingsController(
    ctx.settingsScope.bind({ namespace: MUSIC_NS }),
    ctx,
    'music',
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
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: MUSIC_NS,
      locale: NS,
      inject: () => music.inject(),
    }, GenerateSettingsCard)
  })

  const sessionsService = ctx.get('sessions') as SessionsLike | undefined

  // File upload: a slash-menu command contribution (visible in the "+" command
  // menu, not a standalone composer button). Picking it opens a one-option
  // popupSelect; selecting "choose file" opens the native picker and imports
  // into the session workspace (see file-import.ts). Hidden where the Electron
  // bridge (window.ldd) is absent. The 0.1.5 harness uploads dropped files
  // natively into the attachment store, so this command is the workspace-import
  // entry point (for tools like `analyze_video` that read by workspace path).
  const commandUi = ctx.get('commandUi') as CommandUiContract | undefined
  if (commandUi !== undefined) {
    ctx.effect(() => commandUi.register({
      name: 'file',
      description: () => t('fileImport.commandDescription'),
      available: () => window.ldd !== undefined,
      ui: {
        kind: 'popupSelect',
        options: async () => [{
          id: 'pick',
          label: t('fileImport.optionLabel'),
          detail: t('fileImport.optionDetail'),
        }],
        onSelect: async (_option: unknown, session: { sessionId: SessionId }) => {
          await importWorkspaceFiles(ctx, session.sessionId)
        },
      },
    }), 'generate: file-upload command')
  }

  // Composer generation-model button: the dedicated
  // `conversation.input.generate-model` seat (added by 0005). The stock
  // `conversation.input.model` seat stays the harness-native LLM selector.
  // The picker reads the configured image/video/music models and issues a
  // per-session temporary switch (a `/generate-model <kind> <key>` command).
  // Works without a sessions service (headless browser shells) — the command
  // just no-ops.
  const pickerController = new ModelPickerController(
    {
      image: ctx.settingsScope.bind({ namespace: IMAGE_NS }),
      video: ctx.settingsScope.bind({ namespace: VIDEO_NS }),
      music: ctx.settingsScope.bind({ namespace: MUSIC_NS }),
    },
    sessionsService as CommandableSessions | undefined,
  )
  ctx.slots.inject('conversation.input.generate-model', function* () {
    yield ctx.slots.register({
      name: 'conversation.input.generate-model',
      locale: NS,
      inject: (sessionId: SessionId) => pickerController.inject(sessionId),
    }, GenerateModelPicker)
  })
}

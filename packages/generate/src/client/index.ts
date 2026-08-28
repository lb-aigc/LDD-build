/**
 * Browser half of @ldd/dsh-generate: two settings cards (\"生图模型\" /
 * \"生视频模型\") on the Plugins settings page, one per generation namespace.
 *
 * The cards edit the `generate-image` / `generate-video` settings namespaces the
 * Host half registers, plus the API-key reference through the credentials
 * domain (the key literal never rides a response). Everything is self-contained:
 * the reference ui-settings-plugins package exports only types, so the form
 * model and controls below are vendored here rather than imported.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi) + contribution types.
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Slot + locale type declarations (settings.plugin.item, LocaleNamespaceMap).
import type {} from './slot-contract.ts'

import { GenerateSettingsCard } from './card.tsx'
import { GenerateSettingsController } from './controller.ts'
import { FileDock } from './file-dock.tsx'
import {
  clearImportedFiles,
  describeImportedFiles,
  importFilesIntoWorkspace,
  importWorkspaceFiles,
  removeImportedFile,
} from './file-import.ts'
import type { SessionsLike } from './file-import.ts'
import { en, zh } from './locales.ts'

/** Harness-side hook shape: the conversation service folds staged files into
 *  the prompt text on send, then clears them once the send succeeds. */
interface LddFileHooks {
  readonly inject?: (sessionId: SessionId, text: string) => string
  readonly commit?: (sessionId: SessionId) => void
}

declare global {
  interface Window {
    __lddFileHooks?: LddFileHooks
  }
}

/** Namespace strings the Host half registers (must match src/settings.ts). */
export const IMAGE_NS = 'generate-image'
export const VIDEO_NS = 'generate-video'

const NS = 'generate'

export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'commandUi', 'sessions']

export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'generate: card dictionaries')

  // Submit folding hook: the Harness conversation service calls these to fold
  // staged non-image files into the prompt text (inject) and clear them after
  // a successful send (commit). Absent in a stock Harness build.
  window.__lddFileHooks = {
    inject: (sessionId: SessionId, text: string): string => {
      const desc = describeImportedFiles(sessionId)
      return desc === '' ? text : text + desc
    },
    commit: (sessionId: SessionId): void => {
      clearImportedFiles(sessionId)
    },
  }

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

  // File upload: a slash-menu command contribution (visible in the "+" command
  // menu, not a standalone composer button). Picking it opens a one-option
  // popupSelect; selecting "choose file" opens the native picker and imports
  // into the session workspace (see file-import.ts). Hidden where the Electron
  // bridge (window.ldd) is absent.
  const commandUi = ctx.get('commandUi') as CommandUiContract | undefined
  if (commandUi !== undefined) {
    ctx.effect(() => commandUi.register({
      name: 'file',
      description: t('fileImport.commandDescription'),
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

  // Non-image drag-and-drop → workspace import. The upstream composer's drop
  // handler splits dropped files: images stay on the image rail, everything
  // else is re-emitted as `dsh:non-image-drop` for the workspace import path
  // (the same behaviour as the "+" file-upload command).
  const sessionsService = ctx.get('sessions') as SessionsLike | undefined
  if (sessionsService !== undefined) {
    ctx.effect(() => {
      const onNonImageDrop = (event: Event): void => {
        const detail = (event as CustomEvent<unknown>).detail
        if (!Array.isArray(detail)) return
        // `instanceof File` can fail across isolated realms; accept any
        // object carrying the File surface (arrayBuffer/name/size) instead.
        const files = detail.filter((file): file is File =>
          file !== null && typeof file === 'object' && 'arrayBuffer' in file)
        if (files.length === 0) return
        const sessionId = sessionsService.list.getSnapshot().current
        if (sessionId === undefined) return
        void importFilesIntoWorkspace(ctx, sessionId, files)
      }
      window.addEventListener('dsh:non-image-drop', onNonImageDrop)
      return () => window.removeEventListener('dsh:non-image-drop', onNonImageDrop)
    }, 'generate: non-image drop import')
  }

  // Imported-file cards: rendered INSIDE the composer card via the
  // `conversation.input.files` list slot (declared by ui-conversation beside
  // the draft-image rail), so non-image files and image thumbnails appear in
  // the same input box instead of files floating above it. The slot is
  // shimmed away with a cast so this plugin keeps its zero
  // lockfile-dependency edge on dsh-client-ui-conversation.
  const slotsDock = ctx.slots as unknown as {
    inject: (name: string, register: () => unknown) => void
    register: (config: unknown, component: unknown) => unknown
  }
  slotsDock.inject('conversation.input.files', () => slotsDock.register({
    name: 'conversation.input.files',
    id: 'files',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      sessionId,
      removeFile: (id: string) => { removeImportedFile(sessionId, id) },
    }),
  }, FileDock))
}

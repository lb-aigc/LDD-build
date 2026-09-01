/**
 * Workspace file import (command-contribution half): opens the native file
 * picker, imports each pick into the session workspace through the Electron
 * main process, and tracks the landed files in a session-scoped store that the
 * composer dock renders as file-type cards (icon + name), instead of a plain
 * text note.
 *
 * The non-image files are written into the workspace for the agent's tools to
 * read (the harness prompt protocol only carries text + image, so a file can
 * never be a prompt attachment) — but the UI shows them as cards so the user
 * sees what was imported at a glance, by file type.
 *
 * The structural faces below are vendored (no runtime edge to
 * dsh-client-ui-conversation / apps/desktop): the runtime objects are
 * byte-identical, only the types are shimmed locally.
 */
import { useSyncExternalStore } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Local structural copy of the main-process import result (no apps/desktop edge). */
interface ImportFileResultLike {
  readonly imported: boolean
  readonly relativePath: string
  readonly kind: 'video' | 'image' | 'document' | 'text' | 'other'
  readonly markdownPath?: string
}

declare global {
  interface Window {
    readonly ldd?: {
      importFile(data: ArrayBuffer, fileName: string, workspacePath: string): Promise<ImportFileResultLike>
    }
  }
}

/** Minimal structural face of the per-session input (setDraft / notify / state / addImages). */
interface SessionInputLike {
  setDraft(text: string): void
  notify(level: 'info' | 'error', text: string): void
  state: { getSnapshot(): { draft: string } }
  addImages(ids: readonly string[]): boolean
}

/** Minimal structural face of the conversation service: the input resolver
 * plus the draft-image rail (createDraftImages / releaseDraftImages). */
interface ConversationLike {
  input: { for(actx: ClientContext): SessionInputLike }
  createDraftImages(files: readonly File[]): readonly { id: string }[]
  releaseDraftImages(attachments: readonly { id: string }[]): void
}

/** Image MIME types the draft-image rail accepts (mirrors service.ts imageMediaType). */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function isImageType(type: string): boolean {
  return IMAGE_MEDIA_TYPES.has(type)
}

/** Minimal structural face of the sessions service (scope resolution + current selection). */
export interface SessionsLike {
  scope(id: SessionId): ClientContext | undefined
  list: { getSnapshot(): { current: SessionId | undefined } }
}

/** Minimal structural face of the connection's sessions api (list → cwd). */
interface ConnectionLike {
  api: {
    sessions: {
      list(request: {}): Promise<{
        result: { ok: boolean; value?: { items: Array<{ sessionId: SessionId; cwd?: string }> } }
      }>
    }
  }
}

/* ============================ file-card store ============================ */

/** One non-image file that landed in a session workspace. */
export interface ImportedFile {
  readonly id: string
  readonly name: string
  /** Lowercase extension without the dot, e.g. "zip" ("" when absent). */
  readonly extension: string
  readonly size: number
}

/** Lowercase extension without the dot. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Session-scoped store of imported non-image files (module singleton). */
const filesBySession = new Map<SessionId, ImportedFile[]>()
const listeners = new Set<() => void>()
const EMPTY: ImportedFile[] = []

function snapshot(sessionId: SessionId): ImportedFile[] {
  return filesBySession.get(sessionId) ?? EMPTY
}

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribeFiles(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Reactive hook over the imported-file list for one session. */
export function useImportedFiles(sessionId: SessionId): readonly ImportedFile[] {
  return useSyncExternalStore(subscribeFiles, () => snapshot(sessionId))
}

/** Whether one session currently has any staged non-image files. */
export function hasImportedFiles(sessionId: SessionId): boolean {
  return snapshot(sessionId).length > 0
}

/** Subscribe to the imported-file list changes (module-wide). */
export function subscribeImportedFiles(cb: () => void): () => void {
  return subscribeFiles(cb)
}

/** Remove one imported file card (the file stays in the workspace). */
export function removeImportedFile(sessionId: SessionId, id: string): void {
  const current = filesBySession.get(sessionId)
  if (current === undefined) return
  const next = current.filter((file) => file.id !== id)
  if (next.length === 0) filesBySession.delete(sessionId)
  else filesBySession.set(sessionId, next)
  emit()
}

function recordImported(sessionId: SessionId, files: readonly { name: string; size: number }[]): void {
  if (files.length === 0) return
  const current = filesBySession.get(sessionId) ?? []
  const added: ImportedFile[] = files.map((file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    extension: extensionOf(file.name),
    size: file.size,
  }))
  filesBySession.set(sessionId, [...current, ...added])
  emit()
}

/* ============================ submit folding ============================ */

/**
 * Fold the staged non-image files into prompt text ('' when none). The files
 * are already written into the workspace for the agent's tools to read; this
 * just tells the agent which files the user staged with this message, so the
 * send carries the file reference the way an image attachment would.
 */
export function describeImportedFiles(sessionId: SessionId): string {
  const files = snapshot(sessionId)
  if (files.length === 0) return ''
  const list = files.map((file) => `- ${file.name}`).join('\n')
  return `\n\n[已上传文件，已写入工作区]\n${list}\n请使用文件读取工具查看这些文件。`
}

/** Clear the staged files after a successful send (the Harness calls this). */
export function clearImportedFiles(sessionId: SessionId): void {
  filesBySession.delete(sessionId)
  emit()
}

/* ============================ import pipeline ============================ */

/**
 * Open the native file picker and resolve the chosen files (empty on cancel).
 * A cancelled dialog re-focuses the window without firing `change`; that
 * focus, after a short grace for the change-then-focus ordering, is the
 * cancel signal.
 */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.hidden = true
    let settled = false
    input.onchange = () => {
      settled = true
      const files = Array.from(input.files ?? [])
      input.remove()
      resolve(files)
    }
    const onFocus = (): void => {
      window.removeEventListener('focus', onFocus)
      window.setTimeout(() => {
        if (!settled) {
          settled = true
          input.remove()
          resolve([])
        }
      }, 300)
    }
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
}

/**
 * Import picked files into one session's workspace.
 * @param ctx - the generate plugin's root context (connection + sessions services).
 * @param sessionId - target session.
 */
export async function importWorkspaceFiles(ctx: ClientContext, sessionId: SessionId): Promise<void> {
  const files = await pickFiles()
  if (files.length === 0) return
  await importFilesIntoWorkspace(ctx, sessionId, files)
}

/**
 * Import an already-obtained batch of files into one session's workspace and
 * record the non-image files in the file-card store. Shared by the "+"
 * file-upload command (which picks first) and the composer's non-image
 * drag-and-drop path (which already holds the dropped File objects).
 */
export async function importFilesIntoWorkspace(
  ctx: ClientContext,
  sessionId: SessionId,
  files: readonly File[],
): Promise<void> {
  const sessions = ctx.get('sessions') as SessionsLike | undefined
  const actx = sessions?.scope(sessionId)
  if (actx === undefined) return
  const conversation = actx.get('conversation') as ConversationLike | undefined
  const shell = conversation === undefined ? undefined : conversation.input.for(actx)
  const notify = (level: 'info' | 'error', text: string): void => { shell?.notify(level, text) }

  // Split: images go on the draft-image rail (thumbnail preview, sent with the
  // message), everything else is written into the workspace for the agent's
  // tools to read. This mirrors the drag-and-drop split so "+" and drop agree.
  const images = files.filter((file) => isImageType(file.type))
  const others = files.filter((file) => !isImageType(file.type))

  if (images.length > 0 && conversation !== undefined && shell !== undefined) {
    try {
      const attachments = conversation.createDraftImages(images)
      if (!shell.addImages(attachments.map((attachment) => attachment.id))) {
        // Busy admission phase refused the rail; release the object URLs.
        conversation.releaseDraftImages(attachments)
      }
    } catch (error: unknown) {
      notify('error', error instanceof Error ? error.message : String(error))
    }
  }

  if (others.length === 0) return

  const ldd = window.ldd
  if (ldd === undefined) {
    notify('error', '当前环境不支持文件上传')
    return
  }

  const connection = ctx.get('connection') as ConnectionLike | undefined
  const listed = await connection?.api.sessions.list({})
  const cwd = listed?.result.ok === true
    ? listed.result.value?.items.find((s) => s.sessionId === sessionId)?.cwd
    : undefined
  if (cwd === undefined) {
    notify('error', '当前会话无工作区目录，无法导入文件')
    return
  }

  const landed: { name: string; size: number }[] = []
  for (const file of others) {
    const data = await file.arrayBuffer()
    const res = await ldd.importFile(data, file.name, cwd)
    if (!res.imported) continue
    landed.push({ name: file.name, size: file.size })
  }

  if (landed.length === 0) {
    notify('error', '导入失败')
    return
  }

  // Record the landed files for the composer dock (file-type cards) instead of
  // appending a text note to the draft.
  recordImported(sessionId, landed)
}

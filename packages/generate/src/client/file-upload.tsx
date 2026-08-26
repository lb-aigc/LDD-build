/**
 * File upload: an always-visible control in the composer tool row (the
 * `conversation.input.left` seat, beside the skill picker) that imports
 * arbitrary files into the session workspace so the agent can read them with
 * its own tools — `analyze_video` for video, the read/search tools for text,
 * and parsed Markdown for Word/PDF/Excel documents.
 *
 * The actual file write happens in the Electron MAIN process through the
 * preload bridge (`window.ldd.importFile`), which writes into the workspace
 * directory the agent's tools already resolve against. This keeps the harness
 * data flow untouched: no `PromptContentPart` change, no attachment-service
 * widening. In a plain browser (no `window.ldd`) the button degrades to a
 * no-op.
 */
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Local structural copy of the main-process import result (no apps/desktop edge). */
interface ImportFileResultLike {
  readonly imported: boolean
  readonly relativePath: string
  readonly kind: 'video' | 'image' | 'document' | 'text' | 'other'
  readonly markdownPath?: string
  readonly error?: string
}

declare global {
  interface Window {
    readonly ldd?: {
      importFile(data: ArrayBuffer, fileName: string, workspacePath: string): Promise<ImportFileResultLike>
    }
  }
}

/** Business face injected by the slot registration (per-session importFiles). */
export interface FileUploadFace {
  /**
   * Import a batch of picked files into the session workspace. Returns a
   * single composer note describing the landing (empty string = nothing to
   * inject, e.g. a fully cancelled/failed batch).
   */
  importFiles: (files: readonly File[]) => Promise<string>
}

export type FileUploadProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'generate'>
  & InjectFace<FileUploadFace>

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  height: '24px',
  padding: '0 8px',
  fontSize: '12px',
  fontWeight: 600,
  border: '1px solid var(--dsh-border, #d0d5dd)',
  borderRadius: '6px',
  background: 'var(--dsh-bg-field, #fff)',
  color: 'var(--dsh-fg, #101828)',
  cursor: 'pointer',
}

/**
 * Render the upload button + hidden multi-file input. On pick it imports the
 * files, then lands a short "uploaded" note into the draft through
 * `inputActions.setDraft` so the agent sees the files exist without the user
 * typing anything.
 */
export function FileUpload({ useInput, inputActions, importFiles, t }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return
    setBusy(true)
    try {
      const note = await importFiles(Array.from(files))
      if (note !== '') {
        const draft = useInput(s => s.draft) ?? ''
        const separator = draft !== '' && !draft.endsWith(' ') ? ' ' : ''
        inputActions.setDraft(`${draft}${separator}${note}`)
      }
    } catch {
      // A thrown import degrades to a no-op; the note path already reports
      // per-file failures, and a hard throw should never wedge the composer.
    } finally {
      setBusy(false)
      if (inputRef.current !== null) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        onChange={event => { void onPick(event.target.files) }}
      />
      <button
        type="button"
        style={buttonStyle}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? t('fileUpload.importing') : t('fileUpload.label')}
      </button>
    </>
  )
}

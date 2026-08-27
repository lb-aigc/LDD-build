/**
 * Imported-file cards rendered as a composer-dock entry: non-image files that
 * landed in the session workspace show as file-type chips (badge + name +
 * remove). Pure presentation over the file-import store.
 */
import type { ReactElement } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { useImportedFiles } from './file-import.ts'
import type { GenerateLocaleKey } from './locales.ts'

/** File-kind badge (short label + colour) derived from the extension. */
function fileKindOf(extension: string): { label: string; color: string } {
  switch (extension) {
    case 'zip': case 'rar': case '7z': case 'tar': case 'gz': case 'bz2':
      return { label: 'ZIP', color: '#8a6d1f' }
    case 'pdf': return { label: 'PDF', color: '#c0392b' }
    case 'doc': case 'docx': return { label: 'DOC', color: '#2b579a' }
    case 'xls': case 'xlsx': case 'csv': return { label: 'XLS', color: '#217346' }
    case 'ppt': case 'pptx': return { label: 'PPT', color: '#d24726' }
    case 'txt': case 'md': case 'json': case 'yml': case 'yaml': case 'log':
      return { label: 'TXT', color: '#475467' }
    case 'mp4': case 'mov': case 'avi': case 'mkv': case 'webm': case 'm4v':
      return { label: 'VID', color: '#7c3aed' }
    case 'mp3': case 'wav': case 'flac': case 'ogg': case 'm4a':
      return { label: 'AUD', color: '#0d9488' }
    case 'js': case 'ts': case 'jsx': case 'tsx': case 'py': case 'java':
    case 'c': case 'cpp': case 'h': case 'go': case 'rs': case 'sh': case 'ps1':
      return { label: 'CODE', color: '#475467' }
    default:
      return { label: extension === '' ? 'FILE' : extension.slice(0, 3).toUpperCase(), color: '#667085' }
  }
}

/** A file-type badge: rounded colour chip carrying a short type label. */
function FileKindBadge({ extension }: { extension: string }): ReactElement {
  const kind = fileKindOf(extension)
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '36px',
        height: '22px',
        padding: '0 6px',
        borderRadius: '6px',
        background: kind.color,
        color: '#fff',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {kind.label}
    </span>
  )
}

/** Composer-dock card strip showing imported non-image files by type. */
export function FileDock(props: {
  sessionId: SessionId
  removeFile: (id: string) => void
  t: (key: GenerateLocaleKey) => string
}): ReactElement | null {
  const files = useImportedFiles(props.sessionId)
  if (files.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 0 6px' }}>
      {files.map((file) => (
        <span
          key={file.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 8px 5px 5px',
            border: '1px solid var(--dsw-alias-border-l2, #e4e7ec)',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-layer-2, #fff)',
            color: 'var(--dsw-alias-label-primary, #101828)',
            fontSize: '12px',
            lineHeight: '22px',
          }}
        >
          <FileKindBadge extension={file.extension} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
            {file.name}
          </span>
          <button
            type="button"
            onClick={() => { props.removeFile(file.id) }}
            aria-label={props.t('fileImport.remove')}
            title={props.t('fileImport.remove')}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '0 2px',
              fontSize: '15px',
              lineHeight: 1,
              color: 'var(--dsw-alias-label-tertiary, #667085)',
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

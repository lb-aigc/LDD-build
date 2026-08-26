/**
 * Workspace file import for the LDD desktop shell: writes one uploaded file
 * into a session workspace directory so the agent's own tools can read it.
 *
 * - Video (mp4/mov/mkv/webm) → written verbatim; the agent reads it with
 *   `analyze_video` (the @ldd/dsh-video-frame-analyzer tool).
 * - Text (txt/md/csv/json/...) → written verbatim; the agent reads it with
 *   the read / search tools.
 * - Documents (docx/pdf/xlsx) → parsed to plain text (docx/pdf) or Markdown
 *   tables (xlsx) and written as `<stem>.md`, because `tool-fs read` chokes
 *   on binary office formats.
 * - Images → written verbatim (the composer already has an image rail; this
 *   path is a fallback for reference files the user drops on the tool).
 *
 * Document parsers are lazily imported (per-call dynamic import) so the shell
 * boots without them and a single broken parser never takes down uploads for
 * the other kinds — the parse failure path degrades to writing the original
 * file verbatim and flagging it as `other`.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'

import type { ImportFileKind, ImportFileResult } from './ipc/contracts.ts'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.html', '.log', '.srt', '.vtt'])
const DOCUMENT_EXTS = new Set(['.docx', '.pdf', '.xlsx', '.xls'])

/** Classify one file name into the coarse composer vocabulary. */
function kindOf(fileName: string): ImportFileKind {
  const ext = extname(fileName).toLowerCase()
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (DOCUMENT_EXTS.has(ext)) return 'document'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

/** Reject a path that is not an existing absolute directory. */
async function assertWorkspaceDir(workspacePath: string): Promise<void> {
  if (!isAbsolute(workspacePath)) {
    throw new Error('workspace 路径必须是绝对路径')
  }
  const info = await stat(workspacePath).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) {
    throw new Error('workspace 目录不存在或不是目录')
  }
}

/** Strip the extension and yield the markdown landing name (`剧本.md`). */
function markdownNameOf(fileName: string): string {
  const base = basename(fileName)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `${stem}.md`
}

/** Parse one .docx buffer to plain text via mammoth (lazy). */
async function parseDocx(data: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: data })
  return result.value
}

/** Parse one .pdf buffer to plain text via pdf-parse (lazy; handles Node worker/fonts). */
async function parsePdf(data: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(data) })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}

/** Two-dimensional array → GitHub-flavoured Markdown table. */
function tableToMarkdown(rows: unknown[][]): string {
  if (rows.length === 0) return ''
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
    return text
  }
  const header = rows[0]!.map(cell)
  const divider = header.map(() => '---')
  const body = rows.slice(1).map(row => {
    const padded = [...row]
    while (padded.length < width) padded.push('')
    return padded.map(cell)
  })
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(divider), ...body.map(line)].join('\n')
}

/** Parse one .xlsx/.xls buffer to Markdown tables via SheetJS (lazy). */
async function parseXlsx(data: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(data, { type: 'buffer' })
  const sheets = workbook.SheetNames.map((name: string) => {
    const worksheet = workbook.Sheets[name]!
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as unknown[][]
    return `## ${name}\n\n${tableToMarkdown(rows)}`
  })
  return sheets.join('\n\n')
}

async function parseDocument(data: Buffer, fileName: string): Promise<string> {
  const ext = extname(fileName).toLowerCase()
  if (ext === '.docx') return parseDocx(data)
  if (ext === '.pdf') return parsePdf(data)
  if (ext === '.xlsx' || ext === '.xls') return parseXlsx(data)
  throw new Error(`unsupported document type: ${ext || '(none)'}`)
}

/**
 * Write one uploaded file into a workspace directory. Documents are parsed to
 * Markdown first and landed as `<stem>.md`; everything else lands verbatim.
 */
export async function importWorkspaceFile(
  data: ArrayBuffer,
  fileName: string,
  workspacePath: string,
): Promise<ImportFileResult> {
  const kind = kindOf(fileName)
  const buffer = Buffer.from(data)

  try {
    await assertWorkspaceDir(workspacePath)
  } catch (error) {
    return {
      imported: false,
      relativePath: fileName,
      kind,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (kind === 'document') {
    const markdownPath = markdownNameOf(fileName)
    try {
      const markdown = await parseDocument(buffer, fileName)
      await mkdir(workspacePath, { recursive: true })
      await writeFile(join(workspacePath, markdownPath), markdown, 'utf8')
      return { imported: true, relativePath: fileName, kind, markdownPath }
    } catch (error) {
      // Parse failure degrades to a verbatim write; the agent still sees the
      // file but cannot read it as text — the copy says so.
      await mkdir(workspacePath, { recursive: true })
      await writeFile(join(workspacePath, fileName), buffer)
      return {
        imported: true,
        relativePath: fileName,
        kind: 'other',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  try {
    await mkdir(workspacePath, { recursive: true })
    await writeFile(join(workspacePath, fileName), buffer)
    return { imported: true, relativePath: fileName, kind }
  } catch (error) {
    return {
      imported: false,
      relativePath: fileName,
      kind,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

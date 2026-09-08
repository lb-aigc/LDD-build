/**
 * In-app preview panel: a right-side `WebContentsView` drawer that renders
 * documents (Markdown / text / HTML / images) and hosts a built-in browser for
 * URLs — instead of handing the gesture to an external default application or
 * the system browser. Closing restores the full-width harness surface.
 */
import { BrowserWindow, WebContentsView } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isMarkdownPath, renderMarkdown } from './markdown.ts'

export interface PreviewPanel {
  /** Render a local document (markdown/text/html/image) in the panel. */
  showDocument(path: string): Promise<{ shown: boolean }>
  /** Load a URL in the panel's built-in browser. */
  showUrl(url: string): Promise<{ shown: boolean }>
  /** Hide the panel and restore the full-width harness surface. */
  close(): void
  dispose(): void
}

/** Files the panel renders inline rather than handing to an external opener. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.h', '.cpp', '.hpp', '.css', '.scss', '.sh', '.bat', '.ps1',
  '.ini', '.conf', '.sql', '.vue', '.svelte', '.graphql', '.env', '.gitignore',
])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])

const DEFAULT_PANEL_WIDTH = 480
const MIN_PANEL_WIDTH = 360
const MAX_PANEL_WIDTH = 760
const MIN_HOST_WIDTH = 400
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

function classify(path: string): 'markdown' | 'html' | 'image' | 'text' | 'other' {
  const ext = extname(path).toLowerCase()
  if (isMarkdownPath(path)) return 'markdown'
  if (HTML_EXTENSIONS.has(ext)) return 'html'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'other'
}

function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SHELL_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; }
  .preview-header {
    display: flex; align-items: center; gap: 8px;
    height: 40px; padding: 0 12px;
    border-bottom: 1px solid rgba(127,127,127,0.25);
    background: rgba(0,0,0,0.04);
    font-size: 12px; color: rgba(127,127,127,0.9);
    white-space: nowrap; overflow: hidden;
  }
  .preview-title { flex: 1; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .preview-close {
    border: 0; background: transparent; cursor: pointer; color: inherit;
    font-size: 16px; line-height: 1; padding: 4px 6px; border-radius: 6px;
  }
  .preview-close:hover { background: rgba(127,127,127,0.2); }
  .preview-body { padding: 20px 24px; max-width: 820px; margin: 0 auto; }
  .preview-body img { max-width: 100%; height: auto; }
  .preview-body pre {
    background: rgba(0,0,0,0.05); padding: 12px 14px; border-radius: 8px;
    overflow: auto; font: 12.5px/1.5 "SFMono-Regular", Consolas, monospace;
  }
  .preview-body code {
    background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px;
    font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em;
  }
  .preview-body pre code { background: transparent; padding: 0; }
  .preview-body blockquote {
    margin: 0; padding-left: 12px; border-left: 3px solid rgba(127,127,127,0.4);
    color: rgba(127,127,127,0.9);
  }
  .preview-body a { color: #2f6fed; }
  .preview-body hr { border: 0; border-top: 1px solid rgba(127,127,127,0.25); margin: 20px 0; }
  .preview-note { color: rgba(127,127,127,0.85); padding: 32px 24px; text-align: center; }
`

function wrapperHtml(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${SHELL_CSS}</style>
</head>
<body>
  <div class="preview-header">
    <span class="preview-title">${escapeHtml(title)}</span>
    <button class="preview-close" title="关闭预览" aria-label="关闭预览" onclick="window.lddPreview?.close()">✕</button>
  </div>
  <div class="preview-body">${body}</div>
</body>
</html>`
}

function noteHtml(title: string, message: string): string {
  return wrapperHtml(title, `<div class="preview-note">${escapeHtml(message)}</div>`)
}

/** Inject a floating close button into a directly-loaded page (best effort). */
const FLOATING_CLOSE_JS = `(() => {
  if (document.getElementById('__ldd_preview_close')) return
  const b = document.createElement('button')
  b.id = '__ldd_preview_close'
  b.textContent = '✕'
  b.title = '关闭预览 (Esc)'
  b.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;width:32px;height:32px;border:0;border-radius:8px;background:rgba(0,0,0,0.55);color:#fff;font-size:16px;line-height:1;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3)'
  b.addEventListener('click', () => window.lddPreview && window.lddPreview.close())
  document.body.appendChild(b)
})()`

export function createPreviewPanel(window: BrowserWindow, previewPreloadPath: string): PreviewPanel {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: previewPreloadPath,
    },
  })
  let visible = false
  let attached = false

  const layout = (): void => {
    if (!visible) {
      view.setVisible(false)
      return
    }
    const [width, height] = window.getContentSize() as [number, number]
    const panelWidth = Math.max(
      MIN_PANEL_WIDTH,
      Math.min(DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, width - MIN_HOST_WIDTH),
    )
    view.setBounds({ x: width - panelWidth, y: 0, width: panelWidth, height })
    view.setVisible(true)
  }

  const ensureAttached = (): void => {
    if (attached) return
    window.contentView.addChildView(view)
    attached = true
  }

  function close(): void {
    visible = false
    layout()
  }

  const show = (url: string): { shown: boolean } => {
    ensureAttached()
    visible = true
    layout()
    void view.webContents.loadURL(url)
    return { shown: true }
  }

  function showData(html: string): { shown: boolean } {
    ensureAttached()
    visible = true
    layout()
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return { shown: true }
  }

  // Escape closes the panel when it owns keyboard focus (works for the
  // built-in browser and directly-loaded HTML where the close button may be
  // absent or removed by the page).
  view.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && visible) close()
  })
  // Best-effort floating close button for arbitrary remote pages.
  view.webContents.on('did-finish-load', () => {
    if (!visible) return
    void view.webContents.executeJavaScript(FLOATING_CLOSE_JS).catch(() => undefined)
  })

  window.on('resize', layout)

  return {
    async showDocument(path) {
      const kind = classify(path)
      if (kind === 'other') return { shown: false }
      if (kind === 'html') return show(pathToFileURL(path).href)
      try {
        const bytes = await readFile(path)
        if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
          return showData(noteHtml(basename(path), '文档过大，无法在面板内预览。'))
        }
        if (kind === 'markdown') {
          return showData(wrapperHtml(basename(path), renderMarkdown(bytes.toString('utf8'))))
        }
        if (kind === 'image') {
          const dataUrl = `data:${mediaTypeFor(path)};base64,${bytes.toString('base64')}`
          return showData(wrapperHtml(basename(path), `<img src="${dataUrl}" alt="${escapeHtml(basename(path))}">`))
        }
        return showData(wrapperHtml(basename(path), `<pre>${escapeHtml(bytes.toString('utf8'))}</pre>`))
      } catch (error) {
        return showData(noteHtml(basename(path), `无法读取文档：${error instanceof Error ? error.message : String(error)}`))
      }
    },
    async showUrl(url) {
      return show(url)
    },
    close,
    dispose() {
      view.webContents.close()
      if (attached) window.contentView.removeChildView(view)
    },
  }
}

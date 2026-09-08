/**
 * Minimal, dependency-free Markdown → HTML renderer for the in-app document
 * preview panel. It covers the common authoring surface (headings, fenced
 * code, lists, blockquotes, hr, links, images, emphasis, strikethrough) and is
 * intentionally conservative: raw HTML in the source is escaped, never passed
 * through. It is NOT a full CommonMark implementation — the preview is a
 * reading aid, and the editor-of-record remains the user's external tool.
 */

const ESCAPE_TABLE: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPE_TABLE[character] ?? character)
}

/** Inline span with code spans tokenized first so `*`/`_` inside them survive. */
function renderInline(text: string): string {
  const codeSpans: string[] = []
  let value = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(escapeHtml(code))
    return `\u0000${codeSpans.length - 1}\u0000`
  })
  value = escapeHtml(value)
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  value = value.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  value = value.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return value.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => `<code>${codeSpans[Number(index)] ?? ''}</code>`)
}

const BLOCK_START = /^(#{1,6}\s|```|>\s?|[-*+]\s+|\d+[.)]\s+|---|\*\*\*|___)/u
const HR = /^\s*(---+|\*\*\*+|___+)\s*$/u

/** Render a block of markdown (already split from its container) to HTML. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced code block.
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      out.push(`<pre><code${language === '' ? '' : ` class="language-${escapeHtml(language)}"`}>`)
      i += 1
      const body: string[] = []
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      out.push(escapeHtml(body.join('\n')))
      out.push('</code></pre>')
      i += 1 // closing fence
      continue
    }

    // ATX heading.
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      const level = heading[1]!.length
      out.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      i += 1
      continue
    }

    // Horizontal rule.
    if (HR.test(line)) {
      out.push('<hr>')
      i += 1
      continue
    }

    // Blockquote.
    if (/^>\s?/u.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/u.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(/^>\s?/u, ''))
        i += 1
      }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }

    // List (ordered or unordered).
    const unordered = /^\s*[-*+]\s+(.*)$/u.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/u.exec(line)
    if (unordered !== null || ordered !== null) {
      const isOrdered = ordered !== null
      out.push(isOrdered ? '<ol>' : '<ul>')
      while (i < lines.length) {
        const item = isOrdered
          ? /^\s*\d+[.)]\s+(.*)$/u.exec(lines[i] ?? '')
          : /^\s*[-*+]\s+(.*)$/u.exec(lines[i] ?? '')
        if (item === null) break
        out.push(`<li>${renderInline(item[1] ?? '')}</li>`)
        i += 1
      }
      out.push(isOrdered ? '</ol>' : '</ul>')
      continue
    }

    // Blank line.
    if (/^\s*$/u.test(line)) {
      i += 1
      continue
    }

    // Paragraph: gather until a blank line or a block start.
    const body: string[] = []
    while (i < lines.length && !/^\s*$/u.test(lines[i] ?? '') && !BLOCK_START.test(lines[i] ?? '')) {
      body.push(lines[i] ?? '')
      i += 1
    }
    out.push(`<p>${body.map(renderInline).join('<br>')}</p>`)
  }

  return out.join('\n')
}

/** True when the path names a document the preview panel can render as markdown. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown)$/iu.test(path)
}

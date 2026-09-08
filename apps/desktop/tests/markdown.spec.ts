import { describe, expect, it } from 'vitest'
import { isMarkdownPath, renderMarkdown } from '../src/main/markdown.ts'

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and emphasis', () => {
    const html = renderMarkdown('# Title\n\nA **bold** and *italic* `code` word.')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('escapes raw HTML instead of passing it through', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
    expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;')
  })

  it('renders fenced code blocks and keeps markdown markers literal inside them', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2\n```\n\n`**not bold**`')
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain('1 &lt; 2')
    // `**not bold**` inside a code span must not become <strong>.
    expect(html).not.toContain('<strong>not bold</strong>')
    expect(html).toContain('<code>**not bold**</code>')
  })

  it('renders ordered and unordered lists', () => {
    const html = renderMarkdown('- a\n- b\n\n1. x\n2. y')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>x</li>')
  })

  it('renders links, images, blockquotes and hr', () => {
    const html = renderMarkdown('[text](https://example.com)\n\n![alt](img.png)\n\n> quote\n\n---')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">text</a>')
    expect(html).toContain('<img src="img.png" alt="alt">')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<hr>')
  })
})

describe('isMarkdownPath', () => {
  it('recognizes markdown extensions case-insensitively', () => {
    expect(isMarkdownPath('/w/doc.md')).toBe(true)
    expect(isMarkdownPath('/w/DOC.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('/w/a.txt')).toBe(false)
    expect(isMarkdownPath('/w/a.html')).toBe(false)
  })
})

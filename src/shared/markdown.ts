/**
 * Markdown to an HTML fragment string.
 *
 * It has no react, electron or DOM dependency and runs in the main process. The result is a
 * single `<div class="markdown">` element; the caller supplies the document around it and the
 * print CSS.
 *
 * Raw HTML in the source comes out as literal text. Every text run and every attribute value
 * is escaped at the point of emission, and an anchor is emitted only for an http, https or
 * mailto href — any other scheme renders as the plain text of its label.
 *
 * Supported blocks: `#` through `####` headings; `-`, `+` and `*` bullet lists and `1.` and
 * `1)` ordered lists, nested by indentation and with indented continuation lines joined
 * onto the item above them; `>` quotes; ``` fences; `---`, `***` and `___`
 * thematic breaks; paragraphs whose soft-wrapped lines join with a space and whose lines
 * ending in two spaces or a backslash break hard. Supported inline: `**bold**`, `*italic*`,
 * `` `code` ``, `[text](url)` and bare http(s) links.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g

const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/

/** A line ending in a backslash or in two or more spaces. */
const HARD_BREAK = /(?: {2,}|\\) *$/

/** An indented line carrying text, inside a list: the tail of the item above it. */
const CONTINUATION = /^[ \t]+\S/

/** Whitespace and control characters, stripped from every href. */
const HREF_NOISE = /[\u0000-\u0020\u007f]/g

const SAFE_SCHEME = /^(?:https?:|mailto:)/i

/** `text` with `&`, `<`, `>` and `"` replaced by entities. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * `href` stripped of whitespace and control characters, or null when what remains does not
 * start with http:, https: or mailto:.
 */
function safeHref(href: string): string | null {
  const url = href.replace(HREF_NOISE, '')
  return SAFE_SCHEME.test(url) ? url : null
}

/** An anchor, or the escaped label alone when the href carries an unsupported scheme. */
function externalLink(href: string, label: string): string {
  const url = safeHref(href)
  if (url === null) return escapeHtml(label)
  const attr = escapeHtml(url)
  return `<a href="${attr}" title="${attr}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
}

function renderInline(text: string): string {
  const out: string[] = []
  let last = 0
  INLINE.lastIndex = 0

  for (let m = INLINE.exec(text); m !== null; m = INLINE.exec(text)) {
    if (m.index > last) out.push(escapeHtml(text.slice(last, m.index)))
    const tok = m[0]

    if (tok.startsWith('**')) {
      out.push(`<strong>${escapeHtml(tok.slice(2, -2))}</strong>`)
    } else if (tok.startsWith('`')) {
      out.push(`<code class="md-code">${escapeHtml(tok.slice(1, -1))}</code>`)
    } else if (tok.startsWith('[')) {
      const split = tok.indexOf('](')
      out.push(externalLink(tok.slice(split + 2, -1), tok.slice(1, split)))
    } else if (tok.startsWith('http')) {
      out.push(externalLink(tok, tok))
    } else {
      out.push(`<em>${escapeHtml(tok.slice(1, -1))}</em>`)
    }
    last = m.index + tok.length
  }

  if (last < text.length) out.push(escapeHtml(text.slice(last)))
  return out.join('')
}

/** Lines of one block, joined by a space or by `<br />` where the line breaks hard. */
function renderLines(lines: readonly string[]): string {
  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    parts.push(renderInline(raw.replace(HARD_BREAK, '').trim()))
    if (i === lines.length - 1) continue
    parts.push(HARD_BREAK.test(raw) ? '<br />' : ' ')
  }
  return parts.join('')
}

type ListItem = { indent: number; ordered: boolean; text: string }

/** Columns of leading whitespace, a tab running to the next multiple of four. */
function indentWidth(prefix: string): number {
  let n = 0
  for (const ch of prefix) n = ch === '\t' ? n + 4 - (n % 4) : n + 1
  return n
}

/**
 * One list starting at `items[from]`, with deeper items nested inside the item above them.
 * Returns the list and the index of the first item it did not take.
 */
function renderList(items: readonly ListItem[], from: number): [html: string, next: number] {
  const first = items[from]
  if (!first) return ['', from]

  const tag = first.ordered ? 'ol' : 'ul'
  const parts: string[] = [`<${tag} class="md-list">`]
  let i = from

  while (i < items.length) {
    const item = items[i]
    if (!item || item.indent < first.indent || item.ordered !== first.ordered) break

    let li = `<li>${renderInline(item.text)}`
    i++
    while (i < items.length && (items[i]?.indent ?? -1) > first.indent) {
      const [nested, next] = renderList(items, i)
      li += nested
      i = next
    }
    parts.push(`${li}</li>`)
  }

  parts.push(`</${tag}>`)
  return [parts.join(''), i]
}

/** `source` as an HTML fragment: one `<div class="markdown">` holding the rendered blocks. */
export function renderMarkdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let para: string[] = []

  const flushPara = (): void => {
    if (para.length === 0) return
    blocks.push(`<p>${renderLines(para)}</p>`)
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
      flushPara()
      continue
    }

    if (/^```/.test(line.trim())) {
      flushPara()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        body.push(lines[i] ?? '')
        i++
      }
      blocks.push(`<pre class="md-pre"><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara()
      blocks.push('<hr class="md-hr" />')
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      const level = (heading[1] ?? '#').length
      const text = renderInline((heading[2] ?? '').trim())
      blocks.push(`<h${level} class="md-h md-h${level}">${text}</h${level}>`)
      continue
    }

    if (/^>\s?/.test(line)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        quote.push((lines[i] ?? '').replace(/^>\s?/, ''))
        i++
      }
      i--
      blocks.push(`<blockquote class="md-quote">${renderLines(quote)}</blockquote>`)
      continue
    }

    if (LIST_ITEM.test(line)) {
      flushPara()
      const items: ListItem[] = []
      while (i < lines.length) {
        const raw = lines[i] ?? ''
        const m = LIST_ITEM.exec(raw)
        if (m) {
          items.push({
            indent: indentWidth(m[1] ?? ''),
            ordered: /\d/.test(m[2] ?? ''),
            text: (m[3] ?? '').replace(HARD_BREAK, '').trim()
          })
          i++
          continue
        }
        // An indented non-marker line is the wrapped tail of the item above it.
        const previous = items[items.length - 1]
        if (previous && CONTINUATION.test(raw)) {
          previous.text = `${previous.text} ${raw.replace(HARD_BREAK, '').trim()}`
          i++
          continue
        }
        break
      }
      i--
      let at = 0
      while (at < items.length) {
        const [html, next] = renderList(items, at)
        blocks.push(html)
        at = next
      }
      continue
    }

    para.push(line)
  }
  flushPara()

  return `<div class="markdown">${blocks.join('')}</div>`
}

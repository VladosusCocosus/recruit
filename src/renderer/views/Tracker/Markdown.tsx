/**
 * A deliberately small markdown renderer for item descriptions.
 *
 * It renders to React elements and NEVER touches dangerouslySetInnerHTML. Descriptions can
 * be written by the agent from web search results, so treating them as untrusted text and
 * building the tree ourselves removes the whole injection surface rather than filtering it.
 * Raw HTML in the source is therefore shown as literal text, which is the safe failure mode.
 *
 * Supported: #/##/### headings, - and 1. lists, > quotes, ``` fences, ---, paragraphs;
 * inline **bold**, *italic*, `code`, [text](url) and bare http(s) links.
 */

import type { JSX, ReactNode } from 'react'

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href)
}

function openExternal(url: string): void {
  void window.recruit.openExternal(url)
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  if (!isSafeHref(href)) return <>{children}</>
  return (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        // The renderer must never navigate itself; main opens it in the OS browser.
        e.preventDefault()
        openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  INLINE.lastIndex = 0

  for (let m = INLINE.exec(text); m !== null; m = INLINE.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i++}`

    if (tok.startsWith('**')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="md-code">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('[')) {
      const split = tok.indexOf('](')
      const label = tok.slice(1, split)
      const href = tok.slice(split + 2, -1)
      out.push(
        <ExternalLink key={key} href={href}>
          {label}
        </ExternalLink>
      )
    } else if (tok.startsWith('http')) {
      out.push(
        <ExternalLink key={key} href={tok}>
          {tok}
        </ExternalLink>
      )
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ source }: { source: string }): JSX.Element {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let key = 0

  const flushPara = (): void => {
    if (para.length === 0) return
    const text = para.join(' ')
    blocks.push(<p key={`p${key++}`}>{renderInline(text, `p${key}`)}</p>)
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
      flushPara()
      continue
    }

    // fenced code
    if (/^```/.test(line.trim())) {
      flushPara()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        body.push(lines[i] ?? '')
        i++
      }
      blocks.push(
        <pre key={`c${key++}`} className="md-pre selectable">
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara()
      blocks.push(<hr key={`h${key++}`} className="md-hr" />)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      const level = (heading[1] ?? '#').length
      const text = heading[2] ?? ''
      const Tag = (level <= 2 ? 'h3' : 'h4') as 'h3' | 'h4'
      blocks.push(
        <Tag key={`t${key++}`} className={`md-h md-h${level}`}>
          {renderInline(text, `t${key}`)}
        </Tag>
      )
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
      blocks.push(
        <blockquote key={`q${key++}`} className="md-quote">
          {renderInline(quote.join(' '), `q${key}`)}
        </blockquote>
      )
      continue
    }

    const bullet = /^\s*[-*+]\s+/.test(line)
    const ordered = /^\s*\d+[.)]\s+/.test(line)
    if (bullet || ordered) {
      flushPara()
      const items: string[] = []
      const test = bullet ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/
      while (i < lines.length && test.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(test, ''))
        i++
      }
      i--
      const List = bullet ? 'ul' : 'ol'
      blocks.push(
        <List key={`l${key++}`} className="md-list">
          {items.map((item, n) => (
            <li key={n}>{renderInline(item, `l${key}-${n}`)}</li>
          ))}
        </List>
      )
      continue
    }

    para.push(line.trim())
  }
  flushPara()

  return <div className="markdown selectable">{blocks}</div>
}

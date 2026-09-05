import { describe, expect, it } from 'vitest'
import { renderMarkdownToHtml } from '@shared/markdown'

const OPEN = '<div class="markdown">'
const CLOSE = '</div>'

function body(source: string): string {
  return renderMarkdownToHtml(source).slice(OPEN.length, -CLOSE.length)
}

describe('renderMarkdownToHtml', () => {
  it('wraps the document in a single markdown div', () => {
    expect(renderMarkdownToHtml('hi')).toBe(`${OPEN}<p>hi</p>${CLOSE}`)
  })

  it('emits a fragment with no document wrapper', () => {
    const html = renderMarkdownToHtml('# Title\n\ntext')
    expect(html).not.toContain('<html')
    expect(html).not.toContain('<head')
    expect(html).not.toContain('<body')
  })

  it('renders an empty source as an empty div', () => {
    expect(renderMarkdownToHtml('')).toBe(`${OPEN}${CLOSE}`)
  })
})

describe('block constructs', () => {
  it('renders headings one through four', () => {
    expect(body('# One\n## Two\n### Three\n#### Four')).toBe(
      '<h1 class="md-h md-h1">One</h1>' +
        '<h2 class="md-h md-h2">Two</h2>' +
        '<h3 class="md-h md-h3">Three</h3>' +
        '<h4 class="md-h md-h4">Four</h4>'
    )
  })

  it('renders every unordered bullet marker into one list', () => {
    expect(body('- dash\n* star\n+ plus')).toBe(
      '<ul class="md-list"><li>dash</li><li>star</li><li>plus</li></ul>'
    )
  })

  it('renders both ordered markers', () => {
    expect(body('1. one\n2. two')).toBe('<ol class="md-list"><li>one</li><li>two</li></ol>')
    expect(body('1) one\n2) two')).toBe('<ol class="md-list"><li>one</li><li>two</li></ol>')
  })

  it('starts a new list when the marker kind changes', () => {
    expect(body('- bullet\n1. number')).toBe(
      '<ul class="md-list"><li>bullet</li></ul><ol class="md-list"><li>number</li></ol>'
    )
  })

  it('renders a blockquote with its lines joined', () => {
    expect(body('> first\n> second')).toBe('<blockquote class="md-quote">first second</blockquote>')
  })

  it('renders a fenced code block verbatim', () => {
    expect(body('```\nconst x = 1\nconst y = 2\n```')).toBe(
      '<pre class="md-pre"><code>const x = 1\nconst y = 2</code></pre>'
    )
  })

  it('ignores the info string on a fence', () => {
    expect(body('```ts\ncode\n```')).toBe('<pre class="md-pre"><code>code</code></pre>')
  })

  it('renders all three thematic break markers', () => {
    expect(body('---\n***\n___')).toBe(
      '<hr class="md-hr" /><hr class="md-hr" /><hr class="md-hr" />'
    )
  })

  it('joins soft-wrapped paragraph lines with a space', () => {
    expect(body('one\ntwo\nthree')).toBe('<p>one two three</p>')
  })

  it('splits paragraphs on a blank line', () => {
    expect(body('one\n\ntwo')).toBe('<p>one</p><p>two</p>')
  })

  it('normalises carriage returns', () => {
    expect(body('one\r\ntwo')).toBe('<p>one two</p>')
  })
})

describe('inline constructs', () => {
  it('renders bold', () => {
    expect(body('a **strong** b')).toBe('<p>a <strong>strong</strong> b</p>')
  })

  it('renders italic', () => {
    expect(body('a *slanted* b')).toBe('<p>a <em>slanted</em> b</p>')
  })

  it('renders inline code', () => {
    expect(body('run `npm test` now')).toBe('<p>run <code class="md-code">npm test</code> now</p>')
  })

  it('renders a link', () => {
    expect(body('[Site](https://example.test/a)')).toBe(
      '<p><a href="https://example.test/a" title="https://example.test/a" rel="noopener noreferrer">Site</a></p>'
    )
  })

  it('renders a bare http link', () => {
    expect(body('see https://example.test/a?b=1 now')).toBe(
      '<p>see <a href="https://example.test/a?b=1" title="https://example.test/a?b=1" rel="noopener noreferrer">https://example.test/a?b=1</a> now</p>'
    )
  })

  it('renders a mailto link', () => {
    expect(body('[Email](mailto:hi@example.test)')).toBe(
      '<p><a href="mailto:hi@example.test" title="mailto:hi@example.test" rel="noopener noreferrer">Email</a></p>'
    )
  })

  it('adds rel but no target to anchors', () => {
    const html = renderMarkdownToHtml('[Site](https://example.test)')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('target=')
  })

  it('renders inline constructs inside list items and headings', () => {
    expect(body('# A **bold** title')).toBe('<h1 class="md-h md-h1">A <strong>bold</strong> title</h1>')
    expect(body('- an *italic* item')).toBe('<ul class="md-list"><li>an <em>italic</em> item</li></ul>')
  })
})

describe('wrapped list items', () => {
  it('joins an indented continuation line onto the item above it', () => {
    expect(body('- first line\n  continues here\n- second')).toBe(
      '<ul class="md-list"><li>first line continues here</li><li>second</li></ul>'
    )
  })

  it('keeps a nested list attached to an item that wrapped', () => {
    expect(body('- parent line one\n  line two\n  - child')).toBe(
      '<ul class="md-list"><li>parent line one line two' +
        '<ul class="md-list"><li>child</li></ul></li></ul>'
    )
  })

  it('joins a continuation onto a nested item rather than its parent', () => {
    expect(body('- parent\n  - child one\n    child continues\n- sibling')).toBe(
      '<ul class="md-list"><li>parent<ul class="md-list"><li>child one child continues</li></ul>' +
        '</li><li>sibling</li></ul>'
    )
  })

  it('ends the list at a blank line rather than swallowing the next paragraph', () => {
    expect(body('- item\n\nA new paragraph.')).toBe(
      '<ul class="md-list"><li>item</li></ul><p>A new paragraph.</p>'
    )
  })

  it('ends the list at an unindented line', () => {
    expect(body('- item\nFlush left.')).toBe(
      '<ul class="md-list"><li>item</li></ul><p>Flush left.</p>'
    )
  })
})

describe('nested lists', () => {
  it('nests on a two space indent', () => {
    expect(body('- outer\n  - inner')).toBe(
      '<ul class="md-list"><li>outer<ul class="md-list"><li>inner</li></ul></li></ul>'
    )
  })

  it('nests on a four space indent', () => {
    expect(body('- outer\n    - inner')).toBe(
      '<ul class="md-list"><li>outer<ul class="md-list"><li>inner</li></ul></li></ul>'
    )
  })

  it('nests on a tab indent', () => {
    expect(body('- outer\n\t- inner')).toBe(
      '<ul class="md-list"><li>outer<ul class="md-list"><li>inner</li></ul></li></ul>'
    )
  })

  it('nests an ordered list inside an unordered item', () => {
    expect(body('- outer\n  1. inner')).toBe(
      '<ul class="md-list"><li>outer<ol class="md-list"><li>inner</li></ol></li></ul>'
    )
  })

  it('returns to the outer level after a nested run', () => {
    expect(body('- a\n  - a1\n  - a2\n- b')).toBe(
      '<ul class="md-list">' +
        '<li>a<ul class="md-list"><li>a1</li><li>a2</li></ul></li>' +
        '<li>b</li>' +
        '</ul>'
    )
  })

  it('nests three levels deep', () => {
    expect(body('- a\n  - b\n    - c')).toBe(
      '<ul class="md-list"><li>a' +
        '<ul class="md-list"><li>b' +
        '<ul class="md-list"><li>c</li></ul>' +
        '</li></ul>' +
        '</li></ul>'
    )
  })
})

describe('hard line breaks', () => {
  it('breaks on a line ending in two spaces', () => {
    expect(body('one  \ntwo')).toBe('<p>one<br />two</p>')
  })

  it('breaks on a line ending in more than two spaces', () => {
    expect(body('one    \ntwo')).toBe('<p>one<br />two</p>')
  })

  it('breaks on a line ending in a backslash', () => {
    expect(body('one\\\ntwo')).toBe('<p>one<br />two</p>')
  })

  it('does not break on a single trailing space', () => {
    expect(body('one \ntwo')).toBe('<p>one two</p>')
  })

  it('breaks inside a blockquote', () => {
    expect(body('> one  \n> two')).toBe('<blockquote class="md-quote">one<br />two</blockquote>')
  })

  it('drops a trailing break marker at the end of a block', () => {
    expect(body('one\\')).toBe('<p>one</p>')
    expect(body('one  ')).toBe('<p>one</p>')
  })
})

describe('escaping', () => {
  it('renders a script tag as literal text', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>')
    expect(html).toBe(`${OPEN}<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>${CLOSE}`)
    expect(html).not.toContain('<script')
  })

  it('renders an img with an event handler as literal text', () => {
    const html = renderMarkdownToHtml('<img src=x onerror="alert(1)">')
    expect(html).toBe(`${OPEN}<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>${CLOSE}`)
    expect(html).not.toContain('<img')
  })

  it('escapes an ampersand in body text', () => {
    expect(body('AT&T and R&D')).toBe('<p>AT&amp;T and R&amp;D</p>')
  })

  it('escapes html inside a fenced code block', () => {
    const html = renderMarkdownToHtml('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>')
    expect(html).not.toContain('<script')
  })

  it('escapes html inside inline code', () => {
    expect(body('`<b>x</b>`')).toBe('<p><code class="md-code">&lt;b&gt;x&lt;/b&gt;</code></p>')
  })

  it('escapes html inside a heading', () => {
    expect(body('# <script>x</script>')).toBe(
      '<h1 class="md-h md-h1">&lt;script&gt;x&lt;/script&gt;</h1>'
    )
  })

  it('escapes html inside a list item', () => {
    expect(body('- <script>x</script>')).toBe(
      '<ul class="md-list"><li>&lt;script&gt;x&lt;/script&gt;</li></ul>'
    )
  })

  it('escapes html inside a blockquote', () => {
    expect(body('> <script>x</script>')).toBe(
      '<blockquote class="md-quote">&lt;script&gt;x&lt;/script&gt;</blockquote>'
    )
  })

  it('escapes html inside bold and italic', () => {
    expect(body('**<b>x</b>**')).toBe('<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>')
    expect(body('*<i>x</i>*')).toBe('<p><em>&lt;i&gt;x&lt;/i&gt;</em></p>')
  })

  it('escapes html inside a link label', () => {
    const html = renderMarkdownToHtml('[<img src=x onerror=alert(1)>](https://ok.test)')
    expect(html).toContain('>&lt;img src=x onerror=alert(1)&gt;</a>')
    expect(html).not.toContain('<img')
  })

  it('escapes a quote character inside a url', () => {
    const html = renderMarkdownToHtml('[x](https://e.test/?q="onmouseover="alert(1))')
    expect(html).toContain('href="https://e.test/?q=&quot;onmouseover=&quot;alert(1"')
    expect(html).not.toContain('"onmouseover')
  })
})

describe('link schemes', () => {
  it('rejects a javascript url', () => {
    const html = renderMarkdownToHtml('[x](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('javascript')
  })

  it('rejects a mixed case javascript url', () => {
    const html = renderMarkdownToHtml('[x](JaVaScRiPt:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toMatch(/javascript/i)
  })

  it('rejects a javascript url split by a tab', () => {
    const html = renderMarkdownToHtml('[x](java\tscript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  it('rejects a javascript url split by a control character', () => {
    const html = renderMarkdownToHtml('[x](java\u0001script:alert(1))')
    expect(html).toBe(`${OPEN}<p>x)</p>${CLOSE}`)
  })

  it('rejects a javascript url behind a leading control character', () => {
    const html = renderMarkdownToHtml('[x](\u0001javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  it('rejects a data url', () => {
    const html = renderMarkdownToHtml('[x](data:text/html,<h1>pwned</h1>)')
    expect(html).toBe(`${OPEN}<p>x</p>${CLOSE}`)
  })

  it('rejects a vbscript url', () => {
    const html = renderMarkdownToHtml('[x](vbscript:msgbox(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('vbscript')
  })

  it('rejects a file url', () => {
    const html = renderMarkdownToHtml('[x](file:///etc/passwd)')
    expect(html).toBe(`${OPEN}<p>x</p>${CLOSE}`)
  })

  it('rejects a protocol relative url', () => {
    const html = renderMarkdownToHtml('[x](//evil.test/steal)')
    expect(html).toBe(`${OPEN}<p>x</p>${CLOSE}`)
  })

  it('rejects a relative url', () => {
    const html = renderMarkdownToHtml('[x](../secrets.html)')
    expect(html).toBe(`${OPEN}<p>x</p>${CLOSE}`)
  })

  it('rejects an entity encoded javascript url', () => {
    const html = renderMarkdownToHtml('[x](&#106;avascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  it('accepts http, https and mailto', () => {
    for (const url of ['http://a.test/', 'https://a.test/', 'mailto:a@a.test']) {
      expect(renderMarkdownToHtml(`[x](${url})`)).toContain(`href="${url}"`)
    }
  })
})

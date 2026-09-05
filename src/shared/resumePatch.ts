/**
 * Applying a tailor run's accepted changes to a master resume.
 *
 * Pure: no I/O, no clock, no imports outside src/shared. Every input change comes back in
 * exactly one of `applied` or `unapplied`, and nothing here throws.
 */

import type { AppliedResume, TailorChange, UnappliedChange } from './types'

const HEADING = /^(#{1,6})[ \t]+(.*)$/

/** A half-open range of the working document. */
interface Span {
  start: number
  end: number
}

type Match = { kind: 'found'; span: Span } | { kind: UnappliedChange['reason'] }

/**
 * A whitespace-collapsed view of a document, with the offsets that map each of its
 * characters back to the source it came from.
 */
interface LooseView {
  text: string
  /** Source index each view character begins at. */
  starts: number[]
  /** Source index just past the characters that produced each view character. */
  ends: number[]
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n'
}

function isBlank(text: string): boolean {
  return text.trim().length === 0
}

function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Collapses every run of spaces, tabs and single newlines to one space, and every run
 * containing a blank line to one blank line.
 */
function looseView(text: string): LooseView {
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let i = 0

  while (i < text.length) {
    if (!isWhitespace(text[i])) {
      chars.push(text[i])
      starts.push(i)
      ends.push(i + 1)
      i += 1
      continue
    }

    let j = i
    let newlines = 0
    while (j < text.length && isWhitespace(text[j])) {
      if (text[j] === '\n') newlines += 1
      j += 1
    }
    for (const ch of newlines >= 2 ? '\n\n' : ' ') {
      chars.push(ch)
      starts.push(i)
      ends.push(j)
    }
    i = j
  }

  return { text: chars.join(''), starts, ends }
}

/** Number of occurrences of `needle`, counting overlaps, and the index of the first. */
function occurrences(haystack: string, needle: string): { count: number; first: number } {
  if (needle.length === 0) return { count: 0, first: -1 }
  let count = 0
  let first = -1
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (first < 0) first = at
    count += 1
  }
  return { count, first }
}

/** Where `before` sits in `doc`: exactly if it can, then modulo whitespace. */
function locate(doc: string, before: string): Match {
  const exact = occurrences(doc, before)
  if (exact.count > 1) return { kind: 'ambiguous' }
  if (exact.count === 1) {
    return { kind: 'found', span: { start: exact.first, end: exact.first + before.length } }
  }

  const view = looseView(doc)
  const needle = looseView(before).text.trim()
  if (needle.length === 0) return { kind: 'not_found' }

  const loose = occurrences(view.text, needle)
  if (loose.count > 1) return { kind: 'ambiguous' }
  if (loose.count === 0) return { kind: 'not_found' }

  return {
    kind: 'found',
    span: {
      start: view.starts[loose.first],
      end: view.ends[loose.first + needle.length - 1]
    }
  }
}

/**
 * Removes `span`, taking the whole line with it when nothing but whitespace is left on
 * that line, and collapsing the doubled space it would otherwise leave mid-line.
 */
function cut(doc: string, span: Span): string {
  const lineStart = span.start === 0 ? 0 : doc.lastIndexOf('\n', span.start - 1) + 1
  const newline = doc.indexOf('\n', span.end)
  const lineEnd = newline < 0 ? doc.length : newline

  if (isBlank(doc.slice(lineStart, span.start)) && isBlank(doc.slice(span.end, lineEnd))) {
    return doc.slice(0, lineStart) + doc.slice(newline < 0 ? lineEnd : lineEnd + 1)
  }

  const spaced =
    span.start > lineStart &&
    isSpace(doc[span.start - 1]) &&
    span.end < lineEnd &&
    isSpace(doc[span.end])
  if (!spaced) return doc.slice(0, span.start) + doc.slice(span.end)

  let start = span.start
  let end = span.end
  while (start > lineStart && isSpace(doc[start - 1])) start -= 1
  while (end < lineEnd && isSpace(doc[end])) end += 1
  return `${doc.slice(0, start)} ${doc.slice(end)}`
}

/** A heading or section name reduced to a comparison key. */
function sectionKey(text: string): string {
  return text
    .replace(/^\s*#+\s*/, '')
    .trim()
    .replace(/[\s:.,;!?*_~-]+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Index where a new block belongs inside the section named by `section` — the start of the
 * next heading at the same level or shallower, or the end of the document. -1 when no
 * heading matches.
 */
function sectionEnd(doc: string, section: string): number {
  const wanted = sectionKey(section)
  if (!wanted) return -1

  let level = 0
  let found = false
  let offset = 0

  for (const line of doc.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      if (found && heading[1].length <= level) return offset
      if (!found && sectionKey(heading[2]) === wanted) {
        found = true
        level = heading[1].length
      }
    }
    offset += line.length + 1
  }

  return found ? doc.length : -1
}

function insertBlock(doc: string, section: string, block: string): string {
  const text = block.trim()
  if (!text) return doc

  const at = sectionEnd(doc, section)
  if (at < 0 || at >= doc.length) {
    const head = doc.replace(/\s+$/, '')
    return head === '' ? `${text}\n` : `${head}\n\n${text}\n`
  }

  const head = doc.slice(0, at).replace(/\s+$/, '')
  const tail = doc.slice(at)
  return head === '' ? `${text}\n\n${tail}` : `${head}\n\n${text}\n\n${tail}`
}

function finalise(markdown: string): string {
  const body = markdown.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  return body === '' ? '' : `${body}\n`
}

/**
 * Applies `changes` to `masterMd` in order, each against the result of the previous, and
 * reports the ones that could not be placed.
 *
 * A change with a non-empty `before` replaces its single occurrence; text that occurs more
 * than once is reported 'ambiguous' and text that is absent 'not_found'. A change with an
 * empty `before` is appended to its named section, or to the document when no heading
 * matches. An empty `after` deletes.
 */
export function applyTailorChanges(
  masterMd: string,
  changes: readonly TailorChange[]
): AppliedResume {
  let doc = toLf(masterMd)
  const applied: TailorChange[] = []
  const unapplied: UnappliedChange[] = []

  for (const change of changes) {
    try {
      const after = toLf(change.after)

      if (change.before === '') {
        doc = insertBlock(doc, change.section, after)
        applied.push(change)
        continue
      }

      const match = locate(doc, toLf(change.before))
      if (match.kind !== 'found') {
        unapplied.push({ change, reason: match.kind })
        continue
      }

      doc =
        after === ''
          ? cut(doc, match.span)
          : doc.slice(0, match.span.start) + after + doc.slice(match.span.end)
      applied.push(change)
    } catch {
      unapplied.push({ change, reason: 'not_found' })
    }
  }

  return { markdown: finalise(doc), applied, unapplied }
}

/**
 * MIME -> the flat shape the messages table stores.
 *
 * mailparser handles decoding, charsets and multipart walking. This module adds the three
 * derived fields the rest of the app reasons about: from_domain, thread_key, and snippet.
 */

import { simpleParser, type AddressObject, type Attachment as MailAttachment, type ParsedMail } from 'mailparser'
import type { EmailAddress } from '@shared/types'
import { domainOfAddress } from '../prefilter/index'

/** Snippet length, per the brief. */
const SNIPPET_LENGTH = 200

/**
 * Reply/forward prefixes stripped when deriving a subject-based thread key.
 * Covers en/de/nl/es/fr/nordic, which is what actually shows up in a real inbox.
 */
const REPLY_PREFIX_PATTERN =
  /^\s*(?:(?:re|aw|antw|antwort|fwd?|vs|sv|tr|rv|res|enc|encaminhado|weiterleitung|doorst)\s*(?:\[\d+\])?\s*:\s*)+/i

/** Mailing-list tags like "[jobs-announce] ". */
const LIST_TAG_PATTERN = /^\s*(?:\[[^\]]{1,40}\]\s*)+/

export interface ParsedAttachment {
  filename: string | null
  mimeType: string | null
  size: number | null
  contentId: string | null
  /** text/calendar or a .ics file — the .ics parser should be pointed at these. */
  isCalendar: boolean
  /** cid: part referenced from the HTML body rather than a real user-facing attachment. */
  isInline: boolean
  content: Buffer
}

/** Everything parse produces for one message. Maps 1:1 onto the `messages` columns. */
export interface ParsedMessage {
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  /** Stable per-conversation key. See computeThreadKey. */
  threadKey: string
  fromName: string | null
  fromAddr: string | null
  fromDomain: string | null
  to: EmailAddress[]
  cc: EmailAddress[]
  subject: string | null
  /** ISO-8601 UTC, or null when the message has no usable Date header. */
  dateUtc: string | null
  snippet: string | null
  bodyText: string | null
  bodyHtml: string | null
  listUnsubscribe: string | null
  hasAttachments: boolean
  attachments: ParsedAttachment[]
}

/* ────────────────────────────────────────────────────────────────────────────
 * small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** `<abc@example.com>` -> `abc@example.com`, lowercased. */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/** Split a raw References header (or mailparser's parsed form) into normalized ids. */
export function normalizeReferences(raw: string | string[] | null | undefined): string[] {
  if (!raw) return []
  const parts = Array.isArray(raw) ? raw : raw.split(/[\s,]+/)
  const seen = new Set<string>()
  for (const part of parts) {
    const id = normalizeMessageId(part)
    if (id) seen.add(id)
  }
  return [...seen]
}

/** Strip Re:/Fwd:/list tags, collapse whitespace, lowercase. Used for thread fallback. */
export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return ''
  let out = subject
  // Prefixes and list tags can interleave: "Re: [jobs] Re: Offer".
  for (let i = 0; i < 6; i += 1) {
    const before = out
    out = out.replace(REPLY_PREFIX_PATTERN, '').replace(LIST_TAG_PATTERN, '')
    if (out === before) break
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Stable conversation key.
 *
 * Prefers the root of the References chain, which every conforming client preserves across
 * a whole thread. A root message keys on its own Message-ID, so the first reply — whose
 * References begin with that id — lands on the same key. Only when there are no ids at all
 * do we fall back to normalized subject + sender domain.
 */
export function computeThreadKey(input: {
  messageId?: string | null
  inReplyTo?: string | null
  references?: string[] | string | null
  subject?: string | null
  fromDomain?: string | null
}): string {
  const references = normalizeReferences(input.references)
  const root =
    references[0] ?? normalizeMessageId(input.inReplyTo) ?? normalizeMessageId(input.messageId)
  if (root) return `mid:${root}`

  const subject = normalizeSubject(input.subject)
  const domain = (input.fromDomain ?? '').toLowerCase()
  if (subject || domain) return `subj:${subject}|${domain}`
  return 'subj:|'
}

/** Rough text from an HTML body — good enough for a snippet, not for display. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

/** First ~200 chars of the readable body, whitespace collapsed. */
export function makeSnippet(
  text: string | null | undefined,
  html?: string | null,
  length: number = SNIPPET_LENGTH
): string | null {
  const source = text && text.trim().length > 0 ? text : html ? htmlToText(html) : ''
  const collapsed = source
    // Drop quoted reply blocks so the snippet shows the new content, not the history.
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return null
  return collapsed.length <= length ? collapsed : `${collapsed.slice(0, length).trimEnd()}…`
}

function toAddressList(field: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  if (!field) return []
  const groups = Array.isArray(field) ? field : [field]
  const out: EmailAddress[] = []
  for (const group of groups) {
    for (const entry of group.value ?? []) {
      if (!entry.address) continue
      out.push({ name: entry.name?.trim() || null, address: entry.address.trim() })
    }
  }
  return out
}

/**
 * The raw List-Unsubscribe header.
 *
 * Careful: mailparser does NOT expose `headers.get('list-unsubscribe')`. It folds every
 * `List-*` header into one structured `list` entry —
 *   { unsubscribe: { url, mail }, id: { name, id }, ... }
 * — so the obvious lookup silently returns undefined and the prefilter's newsletter penalty
 * would never fire. Read the raw header line first (it is what the column is meant to hold),
 * and reconstruct from the structured form only as a fallback.
 */
export function readListUnsubscribe(parsed: ParsedMail): string | null {
  for (const line of parsed.headerLines ?? []) {
    if (line.key !== 'list-unsubscribe') continue
    const colon = line.line.indexOf(':')
    const value = (colon >= 0 ? line.line.slice(colon + 1) : line.line).trim()
    if (value) return value
  }

  const list = parsed.headers.get('list') as
    | { unsubscribe?: unknown }
    | undefined
  const unsubscribe = list?.unsubscribe
  if (!unsubscribe) return null

  const entries = Array.isArray(unsubscribe) ? unsubscribe : [unsubscribe]
  const parts: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      parts.push(`<${entry}>`)
      continue
    }
    if (entry && typeof entry === 'object') {
      const { url, mail } = entry as { url?: unknown; mail?: unknown }
      if (typeof url === 'string' && url) parts.push(`<${url}>`)
      if (typeof mail === 'string' && mail) parts.push(`<mailto:${mail}>`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : null
}

function isCalendarPart(attachment: MailAttachment): boolean {
  const mime = (attachment.contentType ?? '').toLowerCase()
  const filename = attachment.filename ?? ''
  return (
    mime === 'text/calendar' ||
    mime === 'application/ics' ||
    mime === 'application/calendar' ||
    /\.ics$/i.test(filename)
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * the parser
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Parse one raw RFC822 message.
 *
 * `internalDateFallback` should be the IMAP INTERNALDATE — plenty of bulk senders ship a
 * malformed or missing Date header, and a message with no date sorts to the bottom forever.
 */
export async function parseMessageSource(
  source: Buffer | string,
  internalDateFallback?: Date | string | null
): Promise<ParsedMessage> {
  const parsed = await simpleParser(source, {
    skipTextLinks: true,
    skipImageLinks: true
  })

  const from = toAddressList(parsed.from ? [parsed.from] : undefined)[0] ?? null
  const fromAddr = from?.address ?? null
  const fromDomain = domainOfAddress(fromAddr)

  const messageId = normalizeMessageId(parsed.messageId)
  const inReplyTo = normalizeMessageId(parsed.inReplyTo)
  const references = normalizeReferences(parsed.references)

  const bodyText = parsed.text && parsed.text.trim().length > 0 ? parsed.text : null
  const bodyHtml = typeof parsed.html === 'string' && parsed.html.trim().length > 0 ? parsed.html : null

  const attachments: ParsedAttachment[] = (parsed.attachments ?? []).map((attachment) => ({
    filename: attachment.filename?.trim() || null,
    mimeType: attachment.contentType?.toLowerCase() || null,
    size: typeof attachment.size === 'number' ? attachment.size : (attachment.content?.length ?? null),
    contentId: attachment.cid?.trim() || null,
    isCalendar: isCalendarPart(attachment),
    // mailparser flags cid: parts referenced from the HTML as `related`.
    isInline: attachment.related === true,
    content: attachment.content
  }))

  let dateUtc: string | null = null
  if (parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime())) {
    dateUtc = parsed.date.toISOString()
  } else if (internalDateFallback) {
    const fallback = new Date(internalDateFallback)
    if (!Number.isNaN(fallback.getTime())) dateUtc = fallback.toISOString()
  }

  const subject = parsed.subject?.trim() || null

  return {
    messageId,
    inReplyTo,
    references,
    threadKey: computeThreadKey({ messageId, inReplyTo, references, subject, fromDomain }),
    fromName: from?.name ?? null,
    fromAddr,
    fromDomain,
    to: toAddressList(parsed.to),
    cc: toAddressList(parsed.cc),
    subject,
    dateUtc,
    snippet: makeSnippet(bodyText, bodyHtml),
    bodyText,
    bodyHtml,
    listUnsubscribe: readListUnsubscribe(parsed),
    // Inline cid: images are already embedded in the HTML — they shouldn't light up
    // the paperclip in the message list.
    hasAttachments: attachments.some((a) => !a.isInline),
    attachments
  }
}

/** Every .ics payload in a parsed message, ready for the ics parser. */
export function calendarParts(message: ParsedMessage): Buffer[] {
  return message.attachments.filter((a) => a.isCalendar).map((a) => a.content)
}

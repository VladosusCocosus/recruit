/**
 * The prefilter: a pure, deterministic scoring function over a single message.
 *
 * This is the ONLY gate between "every message in the inbox" and "messages the agent is
 * allowed to read". It runs before any LLM sees anything, so it must stay pure, cheap and
 * fully unit-tested. No I/O, no clock, no randomness, no DB.
 *
 * Weights come from PREFILTER_WEIGHTS in @shared/types — never hardcode them here.
 */

import {
  ATS_DOMAINS,
  BODY_SIGNAL_PATTERN,
  CAREERS_SENDER_PATTERN,
  MEETING_URL_HOSTS,
  PREFILTER_THRESHOLD_DEFAULT,
  PREFILTER_WEIGHTS,
  SUBJECT_SIGNAL_PATTERN,
  type PrefilterContext,
  type PrefilterFn,
  type PrefilterMessage,
  type PrefilterReason,
  type PrefilterReasonCode,
  type PrefilterResult
} from '@shared/types'

/** Signals at or above this weight are "strong" — they suppress the newsletter penalty. */
const STRONG_SIGNAL_WEIGHT = 0.5

/** Enough body to catch the signal without scanning a megabyte of quoted history. */
const BODY_SCAN_CHARS = 20_000

/** Score is rounded to this many decimals so 0.6 + 0.3 is 0.9, not 0.8999999999999999. */
const SCORE_PRECISION = 3

/* ────────────────────────────────────────────────────────────────────────────
 * domain helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lowercased domain part of an email address, or null. */
export function domainOfAddress(address: string | null | undefined): string | null {
  if (!address) return null
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address
    .slice(at + 1)
    .trim()
    .replace(/^[<[]|[>\]]$/g, '')
    .toLowerCase()
  return domain.length > 0 ? domain : null
}

/** True when `domain` is `candidate` itself or a subdomain of it. */
function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`)
}

/**
 * The most specific entry of `candidates` that `domain` belongs to, or null.
 * "Most specific" = longest match, so mail.us.greenhouse-mail.io reports
 * us.greenhouse-mail.io rather than greenhouse-mail.io.
 */
function bestDomainMatch(domain: string, candidates: Iterable<string>): string | null {
  let best: string | null = null
  for (const raw of candidates) {
    if (!raw) continue
    const candidate = raw.trim().toLowerCase()
    if (!candidate) continue
    if (domainMatches(domain, candidate) && (best === null || candidate.length > best.length)) {
      best = candidate
    }
  }
  return best
}

/* ────────────────────────────────────────────────────────────────────────────
 * signal helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** A calendar invite rides along as a .ics part. Trust any of the three tells. */
function findCalendarAttachment(message: PrefilterMessage): string | null {
  for (const attachment of message.attachments ?? []) {
    const filename = attachment.filename ?? ''
    const mimeType = (attachment.mimeType ?? '').toLowerCase()
    const isCalendar =
      attachment.isCalendar ||
      /\.ics$/i.test(filename) ||
      mimeType === 'text/calendar' ||
      mimeType === 'application/ics'
    if (isCalendar) return filename || mimeType || 'calendar'
  }
  return null
}

/** First meeting host mentioned anywhere in the body. Substring match is deliberate: */
/** the body may be HTML with the URL split across attributes, so don't parse URLs here. */
function findMeetingHost(message: PrefilterMessage): string | null {
  const haystack = `${message.bodyText ?? ''}\n${message.bodyHtml ?? ''}`.toLowerCase()
  if (!haystack.trim()) return null
  for (const host of MEETING_URL_HOSTS) {
    if (haystack.includes(host)) return host
  }
  return null
}

/**
 * Plain text for phrase matching. Prefers bodyText; falls back to bodyHtml with tags
 * crudely stripped, because a phrase like "your application" is routinely split across
 * <span> boundaries in ATS templates and would never match the raw markup.
 */
function scannableBody(message: PrefilterMessage): string {
  const text = message.bodyText?.trim()
  if (text) return text.slice(0, BODY_SCAN_CHARS)
  const html = message.bodyHtml
  if (!html) return ''
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, BODY_SCAN_CHARS)
}

/** Local part of the sender address, lowercased. */
function localPartOf(address: string | null | undefined): string | null {
  if (!address) return null
  const cleaned = address.replace(/^.*<|>.*$/g, '').trim()
  const at = cleaned.lastIndexOf('@')
  if (at <= 0) return null
  return cleaned.slice(0, at).toLowerCase()
}

function reason(code: PrefilterReasonCode, detail?: string): PrefilterReason {
  const weight = PREFILTER_WEIGHTS[code]
  return detail === undefined ? { code, weight } : { code, weight, detail }
}

/* ────────────────────────────────────────────────────────────────────────────
 * the scorer
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Score one message. Returns the score, the reasons that produced it (so the UI can answer
 * "why was this flagged?" on every proposal), and whether it clears the threshold.
 *
 * Signals:
 *   +0.9  thread_key already linked to an item   (strongest — it's a live conversation)
 *   +0.6  sender domain matches an existing item's company_domain
 *   +0.5  sender domain is a known ATS
 *   +0.5  hiring vocabulary in the BODY
 *   +0.35 sender local-part is a careers pipeline address
 *   +0.3  subject matches the hiring-vocabulary pattern
 *   +0.3  .ics attachment, or a meeting URL in the body
 *   -0.15 List-Unsubscribe present AND no single positive signal was >= 0.5
 *
 * Tuned for recall against a 0.35 threshold: any ONE of the body, ATS, domain or thread
 * signals is enough on its own. The newsletter penalty nudges rather than vetoes, because
 * genuine ATS mail is bulk mail and carries List-Unsubscribe too.
 */
export const score: PrefilterFn = (
  message: PrefilterMessage,
  ctx: PrefilterContext
): PrefilterResult => {
  const reasons: PrefilterReason[] = []

  // fromDomain is denormalized onto the row at parse time, but fall back to the address
  // so the function is correct even on a partially-populated message.
  const fromDomain = (message.fromDomain ?? domainOfAddress(message.fromAddr))?.toLowerCase() ?? null

  // +0.5 — applicant tracking system
  if (fromDomain) {
    const ats = bestDomainMatch(fromDomain, ATS_DOMAINS)
    if (ats) reasons.push(reason('ats_domain', ats))
  }

  // +0.6 — a company we are already tracking
  if (fromDomain && ctx.itemDomains.size > 0) {
    const known = bestDomainMatch(fromDomain, ctx.itemDomains)
    if (known) reasons.push(reason('known_company_domain', known))
  }

  // +0.9 — this thread is already attached to an item
  if (message.threadKey && ctx.linkedThreadKeys.has(message.threadKey)) {
    reasons.push(reason('thread_linked', message.threadKey))
  }

  // +0.3 — hiring vocabulary in the subject
  if (message.subject) {
    const match = SUBJECT_SIGNAL_PATTERN.exec(message.subject)
    if (match) reasons.push(reason('subject_keyword', match[0].toLowerCase()))
  }

  // +0.5 — hiring vocabulary in the BODY. The workhorse signal: most application
  // confirmations have an unremarkable subject and an unmistakable body.
  const body = scannableBody(message)
  if (body) {
    const bodyMatch = BODY_SIGNAL_PATTERN.exec(body)
    if (bodyMatch) reasons.push(reason('body_keyword', bodyMatch[0].toLowerCase().trim()))
  }

  // +0.35 — sent from a careers pipeline address
  const localPart = localPartOf(message.fromAddr)
  if (localPart && CAREERS_SENDER_PATTERN.test(localPart)) {
    reasons.push(reason('careers_sender', localPart))
  }

  // +0.3 — a calendar invite or a meeting link
  const calendar = findCalendarAttachment(message)
  if (calendar) {
    reasons.push(reason('meeting_signal', calendar))
  } else {
    const host = findMeetingHost(message)
    if (host) reasons.push(reason('meeting_signal', host))
  }

  // -0.4 — bulk mail, unless something strong already vouched for it
  if (message.listUnsubscribe && message.listUnsubscribe.trim().length > 0) {
    const hasStrongSignal = reasons.some((r) => r.weight >= STRONG_SIGNAL_WEIGHT)
    if (!hasStrongSignal) reasons.push(reason('newsletter_penalty'))
  }

  const raw = reasons.reduce((sum, r) => sum + r.weight, 0)
  const factor = 10 ** SCORE_PRECISION
  const total = Math.round(raw * factor) / factor

  const threshold = ctx.threshold ?? PREFILTER_THRESHOLD_DEFAULT

  return { score: total, reasons, isCandidate: total >= threshold }
}

/** Convenience for callers that only need the boolean. */
export function isCandidate(message: PrefilterMessage, ctx: PrefilterContext): boolean {
  return score(message, ctx).isCandidate
}

export { PREFILTER_THRESHOLD_DEFAULT }

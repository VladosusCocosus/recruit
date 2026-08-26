/**
 * Display formatting shared by every view. Pure functions, no React.
 * Everything takes the ISO-8601 UTC strings that cross IPC — never a Date.
 */

import type { EmailAddress } from '@shared/types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const dayMonthFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const fullFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})
const fullDateTimeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit'
})

/** Mail-list style stamp: time today, weekday this week, then a date. */
export function formatListDate(iso: string | null | undefined, now = Date.now()): string {
  const t = parse(iso)
  if (t === null) return ''
  const d = new Date(t)
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const delta = startOfToday.getTime() - d.getTime()
  if (delta <= 0) return timeFmt.format(d)
  if (delta <= DAY) return 'Yesterday'
  if (delta < 6 * DAY) return weekdayFmt.format(d)
  if (d.getFullYear() === new Date(now).getFullYear()) return dayMonthFmt.format(d)
  return fullFmt.format(d)
}

/** "3m ago", "2h ago", "4d ago". Compact, for activity stamps. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  const t = parse(iso)
  if (t === null) return ''
  const delta = now - t
  if (delta < 0) return formatCountdown(iso, now)
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`
  return formatListDate(iso, now)
}

/** "in 25m", "in 3h", "tomorrow", "in 4d". For Up next. */
export function formatCountdown(iso: string | null | undefined, now = Date.now()): string {
  const t = parse(iso)
  if (t === null) return ''
  const delta = t - now
  if (delta <= 0) return 'now'
  if (delta < MINUTE) return 'in <1m'
  if (delta < HOUR) return `in ${Math.round(delta / MINUTE)}m`
  if (delta < DAY) return `in ${Math.round(delta / HOUR)}h`
  if (delta < 2 * DAY) return 'tomorrow'
  return `in ${Math.round(delta / DAY)}d`
}

/** "Tue, 9 Sep, 14:30". Full stamp for detail views. */
export function formatDateTime(iso: string | null | undefined): string {
  const t = parse(iso)
  if (t === null) return ''
  return fullDateTimeFmt.format(new Date(t))
}

export function formatTime(iso: string | null | undefined): string {
  const t = parse(iso)
  if (t === null) return ''
  return timeFmt.format(new Date(t))
}

/**
 * An all-day .ics event arrives as tz:null with both stamps at UTC midnight
 * (see the mail agent's note on RFC 5545). Detect it so views can drop the time.
 */
export function isAllDay(startsAt: string | null, endsAt: string | null, tz: string | null): boolean {
  if (tz !== null) return false
  const s = parse(startsAt)
  if (s === null) return false
  if (s % DAY !== 0) return false
  const e = parse(endsAt)
  return e === null || e % DAY === 0
}

/** Run-button clock: "7s" under a minute, then "1:05". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "mcp__tracker__list_messages" -> "list_messages". Leaves plain names alone. */
export function formatToolName(raw: string | null | undefined): string {
  if (!raw) return ''
  const match = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(raw)
  if (match?.[1]) return match[1]
  const parts = raw.split('__')
  return parts[parts.length - 1] || raw
}

/** "Ada Lovelace" if we have a name, else the address. */
export function formatSender(name: string | null, address: string | null): string {
  return name?.trim() || address || 'Unknown sender'
}

export function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address
}

export function formatAddressList(list: EmailAddress[], max = 3): string {
  if (list.length === 0) return ''
  const shown = list.slice(0, max).map((a) => a.name || a.address)
  const rest = list.length - shown.length
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ')
}

/** Prefilter score, two decimals. */
export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : score.toFixed(2)
}

/** Agent confidence 0..1 as a percentage. */
export function formatConfidence(confidence: number | null | undefined): string {
  return confidence === null || confidence === undefined ? '' : `${Math.round(confidence * 100)}%`
}

/** "$0.0123" — run costs are small, so don't round them to nothing. */
export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return ''
  if (usd === 0) return '$0'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : formatElapsed(ms)
}

const REASON_LABELS: Record<string, string> = {
  ats_domain: 'Sent from an applicant-tracking system',
  known_company_domain: 'Domain matches a tracked company',
  thread_linked: 'Same thread as a linked message',
  subject_keyword: 'Subject looks recruiting-related',
  meeting_signal: 'Contains a calendar invite or meeting link',
  newsletter_penalty: 'Looks like a bulk mailing'
}

/** Human sentence for a PrefilterReason code — powers "why was this flagged?". */
export function formatReasonCode(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, ' ')
}

export function formatWeight(weight: number): string {
  return `${weight > 0 ? '+' : ''}${weight.toFixed(2).replace(/\.?0+$/, '')}`
}

/** Two-letter monogram for a company avatar. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Anything thrown across IPC, reduced to one line. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    // Electron prefixes invoke rejections with "Error invoking remote method '…':".
    return e.message.replace(/^Error invoking remote method '[^']*':\s*/, '')
  }
  return String(e)
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Display formatting for the Mail views. Pure — no IPC, no React. */

import type {
  Attachment,
  EmailAddress,
  MessageSummary,
  PrefilterReason,
  PrefilterReasonCode,
  TriageState
} from '@shared/types'

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const monthDayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

const DAY_MS = 86_400_000

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Mail-list date column: time today, weekday this week, "Mar 4" this year, else with year. */
export function formatListDate(iso: string | null | undefined, now: Date = new Date()): string {
  const d = toDate(iso)
  if (!d) return ''
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return timeFmt.format(d)
  const age = now.getTime() - d.getTime()
  if (age > 0 && age < 6 * DAY_MS) return weekdayFmt.format(d)
  if (d.getFullYear() === now.getFullYear()) return monthDayFmt.format(d)
  return `${monthDayFmt.format(d)}, ${d.getFullYear()}`
}

/** Reader header date. */
export function formatFullDate(iso: string | null | undefined): string {
  const d = toDate(iso)
  return d ? fullDateFmt.format(d) : 'Unknown date'
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function senderLabel(message: Pick<MessageSummary, 'fromName' | 'fromAddr'>): string {
  return message.fromName?.trim() || message.fromAddr?.trim() || 'Unknown sender'
}

export function subjectLabel(subject: string | null | undefined): string {
  const trimmed = subject?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : '(no subject)'
}

export function addressLabel(address: EmailAddress): string {
  return address.name?.trim() ? `${address.name} <${address.address}>` : address.address
}

export function addressListLabel(addresses: EmailAddress[]): string {
  return addresses.map(addressLabel).join(', ')
}

/* ── prefilter reasons — the "why was this flagged?" line ──────────────────── */

const REASON_LABELS: Record<PrefilterReasonCode, string> = {
  ats_domain: 'ATS sender',
  known_company_domain: 'Known company',
  thread_linked: 'Linked thread',
  subject_keyword: 'Subject match',
  meeting_signal: 'Meeting signal',
  newsletter_penalty: 'Newsletter'
}

export function reasonLabel(reason: PrefilterReason): string {
  return REASON_LABELS[reason.code] ?? reason.code
}

/** "ATS sender · greenhouse.io" — the tooltip / expanded form. */
export function reasonDetailLabel(reason: PrefilterReason): string {
  const base = reasonLabel(reason)
  const weight = reason.weight >= 0 ? `+${reason.weight}` : `${reason.weight}`
  return reason.detail ? `${base} · ${reason.detail} (${weight})` : `${base} (${weight})`
}

/** One-line summary for the collapsed row. */
export function reasonsSummary(reasons: PrefilterReason[]): string {
  return reasons.map(reasonLabel).join(' · ')
}

export function formatScore(score: number | null | undefined): string {
  return score == null ? '—' : score.toFixed(2)
}

/* ── triage ───────────────────────────────────────────────────────────────── */

const TRIAGE_LABELS: Record<TriageState, string> = {
  unseen: 'Unseen',
  candidate: 'Candidate',
  processed: 'Processed',
  dismissed: 'Dismissed',
  linked: 'Linked'
}

export function triageLabel(state: TriageState): string {
  return TRIAGE_LABELS[state] ?? state
}

export function triageTone(state: TriageState): 'neutral' | 'accent' | 'warning' | 'success' {
  switch (state) {
    case 'candidate':
      return 'warning'
    case 'linked':
      return 'success'
    case 'processed':
      return 'accent'
    default:
      return 'neutral'
  }
}

/* ── attachments ──────────────────────────────────────────────────────────── */

export function attachmentLabel(attachment: Attachment): string {
  return attachment.filename?.trim() || attachment.mimeType || 'Attachment'
}

/** Calendar parts arrive with is_calendar set; fall back to sniffing for older rows. */
export function isCalendarAttachment(attachment: Attachment): boolean {
  if (attachment.isCalendar) return true
  const mime = attachment.mimeType?.toLowerCase() ?? ''
  const name = attachment.filename?.toLowerCase() ?? ''
  return mime.includes('text/calendar') || name.endsWith('.ics')
}

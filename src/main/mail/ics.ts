/**
 * .ics parsing for calendar invites that arrive as mail attachments.
 *
 * node-ical does the RFC 5545 heavy lifting; this module normalizes its output into the
 * flat, UTC-only ParsedIcsEvent the rest of the app stores.
 *
 * Two normalizations matter and are the reason this file is unit-tested:
 *
 *  1. ALL-DAY EVENTS. node-ical builds `DTSTART;VALUE=DATE:20260910` with the *local*
 *     timezone, so on a UTC+2 machine it hands back 2026-09-09T22:00:00Z. Storing that
 *     would move an all-day interview onto the previous day for anyone east of UTC. We
 *     rebuild the calendar date from the local Y/M/D and emit UTC midnight, which makes
 *     the result identical on every machine.
 *  2. PARAMETER VALUES. Any property can come back as a bare string or as
 *     `{ val, params }` depending on whether the sender attached parameters
 *     (LANGUAGE, CN, TZID, ...). Everything goes through unwrap() before use.
 *
 * All-day convention: `tz` is null and both timestamps sit at UTC midnight. Per RFC 5545
 * DTEND is EXCLUSIVE, so a one-day event ends at midnight of the following day — that is
 * preserved as-is rather than silently decremented.
 */

import { sync as icalSync } from 'node-ical'
import type { CalendarComponent, VEvent } from 'node-ical'
import { MEETING_URL_HOSTS, type EmailAddress, type ParsedIcsEvent } from '@shared/types'

/** node-ical lowercases and strips the `X-` prefix, so X-GOOGLE-CONFERENCE lands here. */
const GOOGLE_CONFERENCE_KEYS = ['GOOGLE-CONFERENCE', 'X-GOOGLE-CONFERENCE'] as const

/** Bare URLs, stopping before the punctuation that usually wraps or follows them. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/gi

/** Trailing characters that are sentence punctuation rather than part of the URL. */
const TRAILING_JUNK = /[.,;:!?)\]}>'"]+$/

/* ────────────────────────────────────────────────────────────────────────────
 * value unwrapping
 * ──────────────────────────────────────────────────────────────────────────── */

type MaybeParameterValue = string | { val?: unknown; params?: Record<string, unknown> } | undefined | null

/** Collapse a node-ical ParameterValue to its string, or null when empty. */
function unwrap(value: MaybeParameterValue): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'object' && 'val' in value && typeof value.val === 'string') {
    const trimmed = value.val.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

/** Read a parameter (CN, TZID, ...) off a ParameterValue. */
function param(value: MaybeParameterValue, key: string): string | null {
  if (!value || typeof value !== 'object' || !('params' in value) || !value.params) return null
  const raw = value.params[key]
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
}

/** CAL-ADDRESS values are `mailto:someone@example.com`. */
function toEmailAddress(value: MaybeParameterValue): EmailAddress | null {
  const raw = unwrap(value)
  if (!raw) return null
  const address = raw.replace(/^mailto:/i, '').trim()
  if (!address) return null
  return { name: param(value, 'CN'), address }
}

/* ────────────────────────────────────────────────────────────────────────────
 * date normalization
 * ──────────────────────────────────────────────────────────────────────────── */

type IcsDate = (Date & { tz?: string; dateOnly?: true }) | undefined | null

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/**
 * ISO-8601 UTC for a node-ical date.
 *
 * Date-only values are rebuilt from their LOCAL calendar components and re-anchored at UTC
 * midnight — node-ical constructed them with `new Date(y, m, d)`, so the local components
 * are the true calendar date and the UTC instant is an artifact of the host timezone.
 */
function toIsoUtc(value: IcsDate): string | null {
  if (!isValidDate(value)) return null
  if ((value as { dateOnly?: true }).dateOnly === true) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
    ).toISOString()
  }
  return value.toISOString()
}

/**
 * Display timezone for the event. Null for all-day events (they have no meaningful zone)
 * and for plain `Z` timestamps, where node-ical reports the placeholder "Etc/UTC".
 */
function timezoneOf(start: IcsDate, end: IcsDate): string | null {
  const tz = start?.tz ?? end?.tz ?? null
  if (!tz) return null
  if (start?.dateOnly === true) return null
  if (tz === 'Etc/UTC' || tz === 'UTC' || tz === 'Z') return null
  return tz
}

/* ────────────────────────────────────────────────────────────────────────────
 * meeting URLs
 * ──────────────────────────────────────────────────────────────────────────── */

function isMeetingHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return MEETING_URL_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))
}

/**
 * First Google Meet / Zoom / Teams URL found in the given texts, in priority order.
 * Subdomains count — real Zoom links are `<tenant>.zoom.us`.
 */
export function extractMeetingUrl(...texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue
    // Unescape the RFC 5545 escapes node-ical leaves in place, then scan.
    const haystack = text.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';')
    const matches = haystack.match(URL_PATTERN)
    if (!matches) continue
    for (const raw of matches) {
      const candidate = raw.replace(TRAILING_JUNK, '')
      try {
        const url = new URL(candidate)
        if (isMeetingHost(url.hostname)) return url.toString()
      } catch {
        // not a parseable URL — skip
      }
    }
  }
  return null
}

/* ────────────────────────────────────────────────────────────────────────────
 * the parser
 * ──────────────────────────────────────────────────────────────────────────── */

function isVEvent(component: unknown): component is VEvent {
  return (
    typeof component === 'object' &&
    component !== null &&
    (component as { type?: unknown }).type === 'VEVENT'
  )
}

function readGoogleConference(event: VEvent): string | null {
  const bag = event as unknown as Record<string, unknown>
  for (const key of GOOGLE_CONFERENCE_KEYS) {
    const value = unwrap(bag[key] as MaybeParameterValue)
    if (value) return value
  }
  return null
}

function normalizeEvent(event: VEvent, calendarMethod: string | null): ParsedIcsEvent {
  const start = event.start as IcsDate
  const end = event.end as IcsDate

  const summary = unwrap(event.summary as MaybeParameterValue)
  const description = unwrap(event.description as MaybeParameterValue)
  const location = unwrap(event.location as MaybeParameterValue)

  // METHOD may sit on the VEVENT (node-ical copies it down) or only on the VCALENDAR.
  const method = (unwrap(event.method as MaybeParameterValue) ?? calendarMethod)?.toUpperCase() ?? null
  const status = unwrap(event.status as MaybeParameterValue)?.toUpperCase() ?? null

  const rawAttendees = event.attendee
  const attendeeList = Array.isArray(rawAttendees)
    ? rawAttendees
    : rawAttendees !== undefined && rawAttendees !== null
      ? [rawAttendees]
      : []

  const attendees = attendeeList
    .map((a) => toEmailAddress(a as MaybeParameterValue))
    .filter((a): a is EmailAddress => a !== null)

  return {
    uid: unwrap(event.uid as MaybeParameterValue),
    sequence: typeof event.sequence === 'number' && Number.isFinite(event.sequence)
      ? event.sequence
      : null,
    method,
    status,
    summary,
    description,
    location,
    startsAt: toIsoUtc(start),
    endsAt: toIsoUtc(end),
    tz: timezoneOf(start, end),
    organizer: toEmailAddress(event.organizer as MaybeParameterValue),
    attendees,
    // A conference property is the most reliable source; LOCATION beats a prose description.
    meetingUrl:
      extractMeetingUrl(readGoogleConference(event)) ??
      extractMeetingUrl(location) ??
      extractMeetingUrl(description),
    isCancelled: method === 'CANCEL' || status === 'CANCELLED'
  }
}

/**
 * Parse an .ics payload into its VEVENTs, in the order the calendar reports them.
 * Returns [] for anything unparseable — a malformed invite must never break mail sync.
 */
export function parseIcs(source: string | Buffer): ParsedIcsEvent[] {
  const text = typeof source === 'string' ? source : source.toString('utf8')
  if (!text.includes('BEGIN:VEVENT')) return []

  let calendar: Record<string, CalendarComponent | undefined>
  try {
    calendar = icalSync.parseICS(text) as Record<string, CalendarComponent | undefined>
  } catch {
    return []
  }

  const vcalendar = calendar['vcalendar'] as { method?: unknown } | undefined
  const calendarMethod = unwrap(vcalendar?.method as MaybeParameterValue)?.toUpperCase() ?? null

  const events: ParsedIcsEvent[] = []
  for (const component of Object.values(calendar)) {
    if (!isVEvent(component)) continue
    try {
      events.push(normalizeEvent(component, calendarMethod))
    } catch {
      // skip the bad VEVENT, keep the rest
    }
  }
  return events
}

/**
 * The single event an invite is "about" — the common case, since mailed invites carry one
 * VEVENT. Prefers the first event that has a start time. Null when there is nothing usable.
 */
export function parseIcsEvent(source: string | Buffer): ParsedIcsEvent | null {
  const events = parseIcs(source)
  if (events.length === 0) return null
  return events.find((e) => e.startsAt !== null) ?? events[0]
}

/**
 * True when `incoming` supersedes `existing`: same UID and a higher SEQUENCE.
 * This is how a reschedule replaces the meeting already on the timeline.
 */
export function supersedes(
  incoming: Pick<ParsedIcsEvent, 'uid' | 'sequence'>,
  existing: Pick<ParsedIcsEvent, 'uid' | 'sequence'>
): boolean {
  if (!incoming.uid || !existing.uid || incoming.uid !== existing.uid) return false
  return (incoming.sequence ?? 0) > (existing.sequence ?? 0)
}

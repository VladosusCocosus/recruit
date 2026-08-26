/**
 * Tracker-specific date + staleness helpers.
 *
 * The primitives (relative time, all-day detection, date stamps) live in
 * `@renderer/components/format` and are re-exported here rather than reimplemented —
 * the app must not grow two relative-time vocabularies. Only logic that is genuinely
 * about tracker items and their timeline is defined below.
 */

import {
  formatCountdown,
  formatDateTime,
  formatRelative,
  formatTime,
  isAllDay as isAllDayRange
} from '@renderer/components/format'
import type { Item, ItemSummary, TimelineEvent } from '@shared/types'

export { formatCountdown, formatDateTime, formatRelative, formatTime }

/** A card with no activity for this long gets the stale dot. */
export const STALE_AFTER_DAYS = 14

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const utcDayFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Object-shaped wrapper over the shared all-day check. */
export function isAllDay(ev: Pick<TimelineEvent, 'startsAt' | 'endsAt' | 'tz'>): boolean {
  return isAllDayRange(ev.startsAt, ev.endsAt, ev.tz)
}

/**
 * RFC 5545 makes an all-day DTEND *exclusive*: a one-day event ends at the next
 * midnight. Rendering that end date raw would show every onsite as a day longer than
 * it is, so the last day is what gets displayed. All-day stamps are also pinned to
 * UTC — the parser anchors them there, and reading them locally shifts the date for
 * anyone east of UTC.
 */
export function formatAllDayRange(startsAt: string, endsAt: string | null): string {
  const start = parse(startsAt)
  if (start === null) return ''
  const endExclusive = parse(endsAt)
  if (endExclusive === null) return `${utcDayFmt.format(new Date(start))} · all day`

  const lastDay = endExclusive - DAY
  if (lastDay <= start) return `${utcDayFmt.format(new Date(start))} · all day`
  return `${utcDayFmt.format(new Date(start))} – ${utcDayFmt.format(new Date(lastDay))} · all day`
}

/** The one-line "when" on a timeline row. */
export function eventWhen(ev: TimelineEvent): string {
  if (ev.startsAt) {
    if (isAllDay(ev)) return formatAllDayRange(ev.startsAt, ev.endsAt)
    const base = formatDateTime(ev.startsAt)
    const start = parse(ev.startsAt)
    const end = parse(ev.endsAt)
    if (start !== null && end !== null) {
      const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
      if (sameDay) return `${base} – ${formatTime(ev.endsAt)}`
    }
    return base
  }
  return formatDateTime(ev.occurredAt ?? ev.createdAt)
}

/** Sort key for the mixed timeline: scheduled time wins, then occurrence, then creation. */
export function eventTime(ev: TimelineEvent): number {
  return parse(ev.startsAt) ?? parse(ev.occurredAt) ?? parse(ev.createdAt) ?? 0
}

export function isFutureEvent(ev: TimelineEvent, now: number = Date.now()): boolean {
  const start = parse(ev.startsAt)
  if (start === null) return false
  // An event that has started but not finished still reads as "upcoming".
  return (parse(ev.endsAt) ?? start) >= now
}

/** Last thing that happened on an item, whatever the db could tell us. */
export function lastActivityAt(item: Item | ItemSummary): string {
  return (item as Partial<ItemSummary>).lastActivityAt ?? item.updatedAt ?? item.createdAt
}

export interface Staleness {
  stale: boolean
  days: number
}

/**
 * Stale = an OPEN item with nothing scheduled and no activity for STALE_AFTER_DAYS.
 * A booked interview next week is not stale, however quiet the thread has been —
 * flagging those would train the user to ignore the indicator.
 */
export function staleness(
  item: ItemSummary,
  statusKind: 'open' | 'closed',
  now: number = Date.now()
): Staleness {
  const last = parse(lastActivityAt(item))
  const days = last === null ? 0 : Math.floor((now - last) / DAY)
  if (statusKind === 'closed' || item.archivedAt) return { stale: false, days }
  if (item.nextEvent && isFutureEvent(item.nextEvent, now)) return { stale: false, days }
  return { stale: days >= STALE_AFTER_DAYS, days }
}

/** ISO-8601 UTC -> the value an <input type="datetime-local"> expects (local wall clock). */
export function toLocalInputValue(iso: string | null | undefined): string {
  const t = parse(iso)
  if (t === null) return ''
  return new Date(t - new Date(t).getTimezoneOffset() * MINUTE).toISOString().slice(0, 16)
}

/** <input type="datetime-local"> value -> ISO-8601 UTC. Null when empty/invalid. */
export function fromLocalInputValue(value: string): string | null {
  const t = value ? Date.parse(value) : NaN
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function nowIso(): string {
  return new Date().toISOString()
}

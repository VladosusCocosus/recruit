/**
 * Day bucketing for Up next.
 *
 * The subtlety is all-day events. Per the .ics layer's convention, `tz === null` with both
 * stamps on UTC midnight means all-day, and DTEND is EXCLUSIVE (RFC 5545). Reading those in
 * local time would drag a Thursday onsite onto Wednesday for everyone west of Greenwich, so
 * all-day rows are formatted with UTC getters and their end date is shown inclusive.
 *
 * Detection itself comes from the shared `isAllDay` so the whole app agrees on the rule.
 */
import { formatTime, isAllDay as isAllDayStamps } from '@renderer/components'
import type { UpcomingEvent } from '@shared/types'

const DAY_MS = 86_400_000

const dayFullLocal = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})
const dayFullUtc = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC'
})
const dayShortUtc = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t) : null
}

export function isAllDay(event: Pick<UpcomingEvent, 'startsAt' | 'endsAt' | 'tz'>): boolean {
  return isAllDayStamps(event.startsAt, event.endsAt, event.tz)
}

/** The instant an event sorts on. Events without a start fall back to occurredAt. */
export function eventTime(event: UpcomingEvent): number {
  const d = parseIso(event.startsAt) ?? parseIso(event.occurredAt)
  return d ? d.getTime() : Number.POSITIVE_INFINITY
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function utcKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

/**
 * Stable key for the day an event belongs to. All-day events key on their UTC date;
 * timed events key on the viewer's local date.
 */
export function dayKey(event: UpcomingEvent): string {
  const d = parseIso(event.startsAt) ?? parseIso(event.occurredAt)
  if (!d) return 'unscheduled'
  return isAllDay(event) ? utcKey(d) : localKey(d)
}

/** "Today" / "Tomorrow" / "Thursday 28 August". */
export function dayLabel(event: UpcomingEvent, now: number = Date.now()): string {
  const d = parseIso(event.startsAt) ?? parseIso(event.occurredAt)
  if (!d) return 'Unscheduled'

  const allDay = isAllDay(event)
  const key = allDay ? utcKey(d) : localKey(d)
  if (key === localKey(new Date(now))) return 'Today'
  if (key === localKey(new Date(now + DAY_MS))) return 'Tomorrow'
  return allDay ? dayFullUtc.format(d) : dayFullLocal.format(d)
}

/** "14:00", "14:00–15:00", "All day", "All day · to 12 Sep". */
export function timeLabel(event: UpcomingEvent): string {
  const start = parseIso(event.startsAt)
  if (!start) return parseIso(event.occurredAt) ? 'Logged' : 'No date'

  if (isAllDay(event)) {
    const end = parseIso(event.endsAt)
    if (!end) return 'All day'
    // DTEND is exclusive: step back a day to name the last day the event actually covers.
    const lastDay = new Date(end.getTime() - DAY_MS)
    if (lastDay.getTime() <= start.getTime()) return 'All day'
    return `All day · to ${dayShortUtc.format(lastDay)}`
  }

  const head = formatTime(event.startsAt)
  const end = parseIso(event.endsAt)
  if (!end || end.getTime() <= start.getTime()) return head
  return localKey(start) === localKey(end) ? `${head}–${formatTime(event.endsAt)}` : `${head} →`
}

/**
 * True when a timed event is close enough to pull the eye. All-day events never qualify —
 * "today" is already the strongest thing that can be said about them.
 */
export function isImminent(
  event: UpcomingEvent,
  now: number = Date.now(),
  withinMs = 2 * 3_600_000
): boolean {
  if (isAllDay(event)) return false
  const start = parseIso(event.startsAt)
  if (!start) return false
  const diff = start.getTime() - now
  return diff >= -30 * 60_000 && diff <= withinMs
}

/** True while an event is currently running. */
export function isInProgress(event: UpcomingEvent, now: number = Date.now()): boolean {
  const start = parseIso(event.startsAt)
  const end = parseIso(event.endsAt)
  if (!start || !end) return false
  return start.getTime() <= now && end.getTime() > now
}

export interface EventDay {
  key: string
  label: string
  events: UpcomingEvent[]
}

/** Sort soonest-first, then bucket into days preserving that order. */
export function groupByDay(events: UpcomingEvent[], now: number = Date.now()): EventDay[] {
  const sorted = [...events].sort((a, b) => eventTime(a) - eventTime(b))
  const days: EventDay[] = []
  const index = new Map<string, EventDay>()

  for (const event of sorted) {
    const key = dayKey(event)
    let day = index.get(key)
    if (!day) {
      day = { key, label: dayLabel(event, now), events: [] }
      index.set(key, day)
      days.push(day)
    }
    day.events.push(event)
  }
  return days
}

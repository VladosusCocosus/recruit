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
const dayShortLocal = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

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
 *
 * With one override: something that has already started but has not finished belongs to
 * today, whatever day it began on. Without that, a three-day onsite you are in the middle
 * of files itself under a heading two days in the past — at the top of a list whose whole
 * premise is that it looks forward.
 */
export function dayKey(event: UpcomingEvent, now: number = Date.now()): string {
  const d = parseIso(event.startsAt) ?? parseIso(event.occurredAt)
  if (!d) return 'unscheduled'
  if (isInProgress(event, now)) return localKey(new Date(now))
  return isAllDay(event) ? utcKey(d) : localKey(d)
}

/**
 * Whether a `dayKey` lands on the viewer's today. An all-day event keys on UTC and a timed
 * one on local time, and both are compared against the *local* day — that asymmetry is the
 * point: an all-day Thursday onsite is Thursday for everyone, whatever the offset.
 */
export function isTodayKey(key: string, now: number = Date.now()): boolean {
  return key === localKey(new Date(now))
}

/** "Today" / "Tomorrow" / "Thursday 28 August". */
export function dayLabel(event: UpcomingEvent, now: number = Date.now()): string {
  const d = parseIso(event.startsAt) ?? parseIso(event.occurredAt)
  if (!d) return 'Unscheduled'

  const key = dayKey(event, now)
  if (isTodayKey(key, now)) return 'Today'
  if (key === localKey(new Date(now + DAY_MS))) return 'Tomorrow'
  return isAllDay(event) ? dayFullUtc.format(d) : dayFullLocal.format(d)
}

/**
 * "14:00", "2:00 PM", "All day". The START and nothing else.
 *
 * It used to carry the range. That silently assumed a 24-hour locale: "14:00–15:00" fits a
 * narrow column, "2:00 PM–3:00 PM" does not, and widening the column for the worst case
 * wastes a third of the row for everyone else. What you read a schedule for is when a thing
 * starts and how soon that is — the end time is a second question, and `spanLabel` answers
 * it only when the answer is worth the line.
 */
export function timeLabel(event: UpcomingEvent): string {
  const start = parseIso(event.startsAt)
  if (!start) return parseIso(event.occurredAt) ? 'Logged' : 'No date'
  return isAllDay(event) ? 'All day' : formatTime(event.startsAt)
}

/** Today's date, spelled out — the anchor a list of "Today / Tomorrow / Friday" needs. */
export function todayLabel(now: number = Date.now()): string {
  return dayFullLocal.format(new Date(now))
}

/** The long form, for tooltips — where there is no column to fit and nothing is lost. */
export function rangeLabel(event: UpcomingEvent): string {
  const start = parseIso(event.startsAt)
  if (!start) return timeLabel(event)
  if (isAllDay(event)) {
    const span = spanLabel(event)
    return span ? `All day, ${span}` : 'All day'
  }
  const end = parseIso(event.endsAt)
  if (!end || end.getTime() <= start.getTime()) return formatTime(event.startsAt)
  return localKey(start) === localKey(end)
    ? `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`
    : `${formatTime(event.startsAt)}, ${spanLabel(event)}`
}

const MIN_NOTABLE_MS = 90 * 60_000

function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${minutes} min`
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

/**
 * How long this runs — but only when that is news. A half-hour call needs no annotation;
 * a three-hour onsite or an event that spills into next week does, because that is what
 * you plan the rest of the day around. Empty otherwise, and the row drops the line.
 */
export function spanLabel(event: UpcomingEvent): string {
  const start = parseIso(event.startsAt)
  const end = parseIso(event.endsAt)
  if (!start || !end || end.getTime() <= start.getTime()) return ''

  if (isAllDay(event)) {
    // DTEND is exclusive: step back a day to name the last day the event actually covers.
    const lastDay = new Date(end.getTime() - DAY_MS)
    return lastDay.getTime() <= start.getTime() ? '' : `until ${dayShortUtc.format(lastDay)}`
  }
  if (localKey(start) !== localKey(end)) return `until ${dayShortLocal.format(end)}`

  const ms = end.getTime() - start.getTime()
  return ms >= MIN_NOTABLE_MS ? durationLabel(ms) : ''
}

/**
 * True when a timed event is close enough to pull the eye. All-day events never qualify —
 * "today" is already the strongest thing that can be said about them.
 *
 * Strictly ahead of now: something that has already begun is `isInProgress`'s business,
 * and it gets the stronger treatment of the two.
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
  return diff >= 0 && diff <= withinMs
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
  /** The view leads with today, and says so out loud when today has nothing left. */
  isToday: boolean
  events: UpcomingEvent[]
}

/** Sort soonest-first, then bucket into days preserving that order. */
export function groupByDay(events: UpcomingEvent[], now: number = Date.now()): EventDay[] {
  const sorted = [...events].sort((a, b) => eventTime(a) - eventTime(b))
  const days: EventDay[] = []
  const index = new Map<string, EventDay>()

  for (const event of sorted) {
    const key = dayKey(event, now)
    let day = index.get(key)
    if (!day) {
      day = { key, label: dayLabel(event, now), isToday: isTodayKey(key, now), events: [] }
      index.set(key, day)
      days.push(day)
    }
    day.events.push(event)
  }
  return days
}

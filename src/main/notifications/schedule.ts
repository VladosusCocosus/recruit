/**
 * Which notifications are owed, and when. Pure functions over rows the timeline repo
 * already returns — no Electron, no timers, no I/O.
 *
 * A reminder has a moment it falls due (`at`) and a moment it stops being worth showing
 * (`expiresAt`). The expiry is what keeps a restart quiet: Jobbox only notifies while it
 * is running, so on boot the schedule is full of moments that have already gone by, and
 * every one of them must be dropped rather than delivered late in a burst.
 */
import { DEBRIEF_GRACE_MS } from '@shared/debrief'
import { isAllDay } from '@shared/calendar'
import type { PendingDebrief, UpcomingEvent } from '@shared/types'

/** How long past its moment a debrief reminder is still worth showing. */
export const REMINDER_FRESHNESS_MS = 30 * 60_000

export type ReminderKind = 'interview' | 'debrief'

export interface Reminder {
  kind: ReminderKind
  eventId: number
  itemId: number
  /** Epoch ms this reminder falls due. */
  at: number
  /** Epoch ms it stops being worth showing. */
  expiresAt: number
  title: string
  body: string
}

/**
 * Identity for de-duplication. `at` is part of it, so moving an interview produces a new
 * key and the moved event reminds again.
 */
export function reminderKey(reminder: Reminder): string {
  return `${reminder.kind}:${reminder.eventId}:${reminder.at}`
}

/** "in 15 minutes", "in 1 hour". Whole hours read as hours; everything else as minutes. */
export function leadPhrase(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m >= 60 && m % 60 === 0) {
    const hours = m / 60
    return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `in ${m} ${m === 1 ? 'minute' : 'minutes'}`
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' · ')
}

/**
 * One reminder per timed event, a lead time before it starts. All-day events are skipped:
 * they have no start time a lead can be measured from.
 */
export function interviewReminders(events: UpcomingEvent[], leadMinutes: number): Reminder[] {
  const leadMs = Math.max(0, Math.round(leadMinutes)) * 60_000
  const out: Reminder[] = []
  for (const event of events) {
    if (isAllDay(event.startsAt, event.endsAt, event.tz)) continue
    const starts = parseMs(event.startsAt)
    if (starts === null) continue
    out.push({
      kind: 'interview',
      eventId: event.id,
      itemId: event.itemId,
      at: starts - leadMs,
      expiresAt: starts,
      title: event.title,
      body: join([event.item.company, event.item.role, leadPhrase(leadMinutes)])
    })
  }
  return out
}

/**
 * One reminder per call that will owe a debrief, at the moment it comes due — the grace
 * period after it ends, or the end of a snooze that outlasts it. Takes every candidate,
 * not just the calls already pending, so a call can be scheduled before it comes due.
 */
export function debriefReminders(candidates: PendingDebrief[]): Reminder[] {
  const out: Reminder[] = []
  for (const call of candidates) {
    if (call.kind !== 'meeting' || call.callType === null) continue
    if (call.debriefedAt !== null || call.supersededBy !== null) continue
    const ends = parseMs(call.endsAt)
    if (ends === null) continue

    const snooze = parseMs(call.snoozeUntil)
    const at = Math.max(ends + DEBRIEF_GRACE_MS, snooze ?? 0)
    out.push({
      kind: 'debrief',
      eventId: call.id,
      itemId: call.itemId,
      at,
      expiresAt: at + REMINDER_FRESHNESS_MS,
      title: 'How did it go?',
      body: join([call.title, call.item.company])
    })
  }
  return out
}

/** Reminders whose moment has arrived, have not expired, and have not already fired. */
export function dueReminders(
  reminders: Reminder[],
  fired: ReadonlySet<string>,
  now: number
): Reminder[] {
  return reminders.filter(
    (r) => r.at <= now && now < r.expiresAt && !fired.has(reminderKey(r))
  )
}

/** The next moment worth waking for, or null when nothing is left ahead. */
export function nextWakeAt(
  reminders: Reminder[],
  fired: ReadonlySet<string>,
  now: number
): number | null {
  let soonest: number | null = null
  for (const reminder of reminders) {
    if (reminder.at <= now) continue
    if (fired.has(reminderKey(reminder))) continue
    if (soonest === null || reminder.at < soonest) soonest = reminder.at
  }
  return soonest
}

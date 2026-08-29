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
import type { CloseReason, Item, ItemSummary, TimelineEvent } from '@shared/types'

export { formatCountdown, formatDateTime, formatRelative, formatTime }

/** A card with no contact for this long gets the stale dot. */
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

/**
 * Date of the most recent linked email, or null when nothing is linked yet. Narrower
 * than `lastContactAt`: a call logged by hand is contact but is not a message, and
 * this one answers "when did they last write?".
 */
export function lastMessageAt(item: Item | ItemSummary): string | null {
  return (item as Partial<ItemSummary>).lastMessageAt ?? null
}

/**
 * Newest proof that something actually happened: mail either way, or a timeline entry
 * someone logged. Falls back to when the item was created — an application filed a
 * month ago that never drew a reply has been quiet for a month, not for zero days.
 */
export function lastContactAt(item: Item | ItemSummary): string {
  return (item as Partial<ItemSummary>).lastContactAt ?? item.createdAt
}

export interface Staleness {
  stale: boolean
  days: number
}

/**
 * Stale = an OPEN item with nothing scheduled and no contact for STALE_AFTER_DAYS.
 * A booked interview next week is not stale, however quiet the thread has been —
 * flagging those would train the user to ignore the indicator.
 *
 * Measured from `lastContactAt`, not `updatedAt`: the old reading reset the clock
 * every time a sync linked a message or the user edited a field, so the dot mostly
 * meant "nobody has touched this row" — which is not the question being asked.
 */
export function staleness(
  item: ItemSummary,
  statusKind: 'open' | 'closed',
  now: number = Date.now()
): Staleness {
  const last = parse(lastContactAt(item))
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

/* ── close reasons ─────────────────────────────────────────────────────────── */

/**
 * Why an application ended. Lives here rather than beside a control because three
 * different surfaces render it — the inspector's popup, the card's contextual menu and
 * the signal line below — and none of them should own the vocabulary.
 */
export const CLOSE_REASONS: ReadonlyArray<{ value: CloseReason; label: string }> = [
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'ghosted', label: 'Ghosted' }
]

export function closeReasonLabel(reason: CloseReason | null): string | null {
  return CLOSE_REASONS.find((r) => r.value === reason)?.label ?? null
}

/* ── the signal line ───────────────────────────────────────────────────────── */

export type SignalTone = 'urgent' | 'upcoming' | 'warning' | 'quiet'

export interface ItemSignal {
  icon: 'calendar' | 'clock'
  /** One line, already assembled. Truncated by CSS, never by this function. */
  text: string
  tone: SignalTone
  /** The long form, for the title attribute. */
  title: string
}

/** Inside this window an event is something you are about to do, not something booked. */
const SOON_MS = 2 * DAY

/**
 * The single line every card and row ends with.
 *
 * The old board showed a filled blue pill whenever an item had *any* future event and a
 * bare orange dot whenever it was stale. Both are binary, so a week of interviews and a
 * casual coffee next month looked identical, and a board where most cards are blue
 * teaches people to stop reading blue.
 *
 * So each item gets exactly one fact — the one that would make somebody act — and the
 * colour carries urgency rather than mere existence:
 *
 *   urgent    an interview inside 48 hours
 *   upcoming  something scheduled further out
 *   warning   open, nothing booked, and quiet past the stale threshold
 *   quiet     everything else: when this thread last moved
 *
 * Closed items skip all of it and show their close reason, which by then is the only
 * thing still worth knowing.
 */
export function itemSignal(
  item: ItemSummary,
  statusKind: 'open' | 'closed',
  now: number = Date.now()
): ItemSignal {
  const last = lastContactAt(item)

  // `lastContactAt()` falls back to createdAt, so the raw field is what says whether
  // contact ever actually happened. Calling a filed-and-forgotten application's creation
  // date its "last contact" would be a lie about a row nobody ever replied to.
  const contacted = item.lastContactAt !== null

  if (statusKind === 'closed') {
    const reason = closeReasonLabel(item.closeReason) ?? 'Closed'
    return {
      icon: 'clock',
      text: `${reason} · ${formatRelative(last, now)}`,
      tone: 'quiet',
      title: contacted
        ? `${reason} — last contact ${formatDateTime(last)}`
        : `${reason} — added ${formatDateTime(item.createdAt)}, never heard back`
    }
  }

  const next = item.nextEvent
  if (next && isFutureEvent(next, now)) {
    const start = parse(next.startsAt)
    return {
      icon: 'calendar',
      text: `${next.title} · ${formatCountdown(next.startsAt, now)}`,
      tone: start !== null && start - now <= SOON_MS ? 'urgent' : 'upcoming',
      title: `${next.title} — ${eventWhen(next)}`
    }
  }

  const { stale, days } = staleness(item, statusKind, now)
  if (stale) {
    return {
      icon: 'clock',
      text: `Quiet for ${days} days`,
      tone: 'warning',
      title: `Nothing since ${formatDateTime(last)} — no reply, and nothing booked`
    }
  }

  return {
    icon: 'clock',
    text: contacted ? `Last contact ${formatRelative(last, now)}` : `Added ${formatRelative(item.createdAt, now)}`,
    tone: 'quiet',
    title: contacted ? `Last contact ${formatDateTime(last)}` : `Added ${formatDateTime(item.createdAt)}`
  }
}

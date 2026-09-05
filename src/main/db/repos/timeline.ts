import type {
  CallDebriefInput,
  PendingDebrief,
  TimelineEvent,
  TimelineEventInput,
  UpcomingEvent
} from '@shared/types'
import { isDebriefPending } from '@shared/debrief'
import { count, execute, placeholders, queryAll, queryOne, transact } from '../connection'
import { nowIso, rowToTimelineEvent, type TimelineEventRow } from '../rows'

const SELECT = 'SELECT * FROM timeline_events'

export interface TimelineQuery {
  /** Superseded events are hidden by default — they are .ics history, not the schedule. */
  includeSuperseded?: boolean
}

export function listTimeline(itemId: number, query: TimelineQuery = {}): TimelineEvent[] {
  const filter = query.includeSuperseded ? '' : 'AND superseded_by IS NULL'
  return queryAll<TimelineEventRow>(
    `${SELECT} WHERE item_id = ? ${filter}
     ORDER BY COALESCE(starts_at, occurred_at, created_at) DESC, id DESC`,
    itemId
  ).map(rowToTimelineEvent)
}

export function getEvent(eventId: number): TimelineEvent | null {
  const row = queryOne<TimelineEventRow>(`${SELECT} WHERE id = ?`, eventId)
  return row ? rowToTimelineEvent(row) : null
}

export function addEvent(input: TimelineEventInput): TimelineEvent {
  const info = execute(
    `INSERT INTO timeline_events (
       item_id, kind, title, body_md, occurred_at, starts_at, ends_at, tz,
       location, meeting_url, message_id, ics_uid, ics_sequence, source,
       call_type, call_with, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.itemId,
    input.kind,
    input.title,
    input.bodyMd ?? null,
    input.occurredAt ?? null,
    input.startsAt ?? null,
    input.endsAt ?? null,
    input.tz ?? null,
    input.location ?? null,
    input.meetingUrl ?? null,
    input.messageId ?? null,
    input.icsUid ?? null,
    input.icsSequence ?? null,
    input.source ?? 'user',
    input.callType ?? null,
    input.callWith ?? null,
    nowIso()
  )
  return getEvent(Number(info.lastInsertRowid)) as TimelineEvent
}

export function updateEvent(eventId: number, patch: Partial<TimelineEventInput>): TimelineEvent {
  const sets: string[] = []
  const params: unknown[] = []
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.itemId !== undefined) put('item_id', patch.itemId)
  if (patch.kind !== undefined) put('kind', patch.kind)
  if (patch.title !== undefined) put('title', patch.title)
  if (patch.bodyMd !== undefined) put('body_md', patch.bodyMd)
  if (patch.occurredAt !== undefined) put('occurred_at', patch.occurredAt)
  if (patch.startsAt !== undefined) put('starts_at', patch.startsAt)
  if (patch.endsAt !== undefined) put('ends_at', patch.endsAt)
  if (patch.tz !== undefined) put('tz', patch.tz)
  if (patch.location !== undefined) put('location', patch.location)
  if (patch.meetingUrl !== undefined) put('meeting_url', patch.meetingUrl)
  if (patch.messageId !== undefined) put('message_id', patch.messageId)
  if (patch.icsUid !== undefined) put('ics_uid', patch.icsUid)
  if (patch.icsSequence !== undefined) put('ics_sequence', patch.icsSequence)
  if (patch.source !== undefined) put('source', patch.source)
  if (patch.callType !== undefined) put('call_type', patch.callType)
  if (patch.callWith !== undefined) put('call_with', patch.callWith)

  if (sets.length) {
    params.push(eventId)
    execute(`UPDATE timeline_events SET ${sets.join(', ')} WHERE id = ?`, ...params)
  }
  const event = getEvent(eventId)
  if (!event) throw new Error(`Timeline event ${eventId} not found`)
  return event
}

export function deleteEvent(eventId: number): void {
  execute('DELETE FROM timeline_events WHERE id = ?', eventId)
}

/**
 * What "Up next" and the rail badge both mean by upcoming.
 *
 * Not simply `starts_at >= now`: a meeting that began ten minutes ago is the single most
 * relevant thing on the screen, and an all-day event stamped at UTC midnight is already in
 * the past by that test for every viewer east of Greenwich. So an event stays upcoming
 * while it is still running — which is exactly what lets the view mark one row "Now".
 *
 * Both bound params are the same instant; SQLite has no named parameters here.
 */
const UPCOMING = `te.superseded_by IS NULL
       AND te.starts_at IS NOT NULL
       AND (te.starts_at >= ? OR te.ends_at > ?)
       AND i.archived_at IS NULL`

/** "Up next": everything still ahead of you across all items, soonest first. */
export function upcomingEvents(limit = 50): UpcomingEvent[] {
  const now = nowIso()
  const rows = queryAll<
    TimelineEventRow & {
      item_company: string
      item_role: string | null
      item_status_key: string
    }
  >(
    `SELECT te.*, i.company AS item_company, i.role AS item_role, s.key AS item_status_key
     FROM timeline_events te
     JOIN items i ON i.id = te.item_id
     JOIN statuses s ON s.id = i.status_id
     WHERE ${UPCOMING}
     ORDER BY te.starts_at ASC, te.id ASC
     LIMIT ?`,
    now,
    now,
    limit
  )
  return rows.map((row) => ({
    ...rowToTimelineEvent(row),
    item: {
      id: row.item_id,
      company: row.item_company,
      role: row.item_role,
      statusKey: row.item_status_key
    }
  }))
}

const SOON_MS = 24 * 60 * 60 * 1000

/**
 * The rail badge: the next twenty-four hours, not the whole horizon.
 *
 * A count of every future event is inventory, not a prompt — it reads "40" for weeks and
 * means nothing. A rolling window is something you can act on.
 *
 * Deliberately a window and not "today". Calling it today would put a calendar day into
 * SQL, and a calendar day here is not one thing: all-day events are stored at UTC midnight
 * while a person's day starts wherever they are, so "is this today" needs the same
 * all-day-versus-timed reasoning `isAllDay` does in the renderer — reimplemented in SQL,
 * where it would quietly drift. A window is pure instant arithmetic and cannot drift. It
 * also answers better: at 21:00 "today" says nothing about the 09:00 interview tomorrow.
 */
export function countEventsSoon(): number {
  const now = nowIso()
  return count(
    `SELECT count(*) FROM timeline_events te
     JOIN items i ON i.id = te.item_id
     WHERE ${UPCOMING} AND te.starts_at < ?`,
    now,
    now,
    new Date(Date.now() + SOON_MS).toISOString()
  )
}

/** Soonest future event per item. Used to fill ItemSummary.nextEvent in one extra query. */
export function nextEventsFor(itemIds: number[], from = nowIso()): Map<number, TimelineEvent> {
  const out = new Map<number, TimelineEvent>()
  if (!itemIds.length) return out
  const rows = queryAll<TimelineEventRow>(
    `${SELECT} WHERE item_id IN (${placeholders(itemIds.length)})
       AND superseded_by IS NULL AND starts_at IS NOT NULL AND starts_at >= ?
     ORDER BY starts_at ASC, id ASC`,
    ...itemIds,
    from
  )
  for (const row of rows) {
    if (!out.has(row.item_id)) out.set(row.item_id, rowToTimelineEvent(row))
  }
  return out
}

/** Live (not-yet-superseded) events on an item carrying this .ics UID. */
export function findLiveEventsByIcsUid(itemId: number, icsUid: string): TimelineEvent[] {
  return queryAll<TimelineEventRow>(
    `${SELECT} WHERE item_id = ? AND ics_uid = ? AND superseded_by IS NULL ORDER BY id`,
    itemId,
    icsUid
  ).map(rowToTimelineEvent)
}

/** Point `eventId` at its replacement. A superseded event stays for history but is hidden. */
export function supersedeEvent(eventId: number, supersededBy: number): void {
  execute('UPDATE timeline_events SET superseded_by = ? WHERE id = ?', supersededBy, eventId)
}

/* ── call debriefs ─────────────────────────────────────────────────────────── */

/**
 * Logged calls that still owe a debrief: finished, unanswered, not snoozed, on a live
 * item. The SQL selects candidates; `isDebriefPending` applies the grace and snooze
 * windows.
 */
export function pendingDebriefs(now: number = Date.now()): PendingDebrief[] {
  const rows = queryAll<
    TimelineEventRow & {
      item_company: string
      item_role: string | null
      item_status_key: string
      item_contact_name: string | null
    }
  >(
    `SELECT te.*, i.company AS item_company, i.role AS item_role,
            i.contact_name AS item_contact_name, s.key AS item_status_key
     FROM timeline_events te
     JOIN items i ON i.id = te.item_id
     JOIN statuses s ON s.id = i.status_id
     WHERE te.superseded_by IS NULL
       AND te.kind = 'meeting'
       AND te.call_type IS NOT NULL
       AND te.debriefed_at IS NULL
       AND te.ends_at IS NOT NULL
       AND i.archived_at IS NULL
     ORDER BY te.ends_at ASC, te.id ASC`
  )

  const out: PendingDebrief[] = []
  for (const row of rows) {
    const event = rowToTimelineEvent(row)
    if (!isDebriefPending(event, now)) continue
    out.push({
      ...event,
      item: {
        id: row.item_id,
        company: row.item_company,
        role: row.item_role,
        statusKey: row.item_status_key,
        contactName: row.item_contact_name
      }
    })
  }
  return out
}

/**
 * Stamps the call with its outcome and appends the debrief's output in one transaction:
 * a `note` event for the write-up, and a `task` event per follow-up and for the nudge.
 *
 * Returns the id of the item the call belongs to. Throws when `eventId` is not a call.
 */
export function saveDebrief(input: CallDebriefInput): number {
  return transact(() => {
    const call = getEvent(input.eventId)
    if (!call) throw new Error(`Timeline event ${input.eventId} not found`)
    if (call.callType === null) throw new Error(`Timeline event ${input.eventId} is not a call`)

    const answeredAt = nowIso()
    execute(
      'UPDATE timeline_events SET outcome = ?, debriefed_at = ?, snooze_until = NULL WHERE id = ?',
      input.outcome,
      answeredAt,
      input.eventId
    )

    const notes = input.notes?.trim()
    if (notes) {
      addEvent({
        itemId: call.itemId,
        kind: 'note',
        title: `Debrief — ${call.title}`,
        bodyMd: notes,
        occurredAt: answeredAt,
        source: 'user'
      })
    }

    const tasks = [...(input.followUps ?? [])]
    if (input.nudge) tasks.push(input.nudge)
    for (const task of tasks) {
      const title = task.title.trim()
      if (!title) continue
      addEvent({
        itemId: call.itemId,
        kind: 'task',
        title,
        startsAt: task.dueAt,
        tz: call.tz,
        source: 'user'
      })
    }

    return call.itemId
  })
}

/** Holds the debrief back until `untilIso`. Returns the call's item id. */
export function snoozeDebrief(eventId: number, untilIso: string): number | null {
  execute('UPDATE timeline_events SET snooze_until = ? WHERE id = ?', untilIso, eventId)
  return getEvent(eventId)?.itemId ?? null
}

/** Marks the debrief answered with no outcome. Returns the call's item id. */
export function skipDebrief(eventId: number): number | null {
  execute(
    'UPDATE timeline_events SET debriefed_at = ?, snooze_until = NULL WHERE id = ?',
    nowIso(),
    eventId
  )
  return getEvent(eventId)?.itemId ?? null
}

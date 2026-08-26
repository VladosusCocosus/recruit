import type { TimelineEvent, TimelineEventInput, UpcomingEvent } from '@shared/types'
import { count, execute, placeholders, queryAll, queryOne } from '../connection'
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
       location, meeting_url, message_id, ics_uid, ics_sequence, source, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

/** "Up next": every future scheduled event across all items, soonest first. */
export function upcomingEvents(limit = 50): UpcomingEvent[] {
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
     WHERE te.superseded_by IS NULL
       AND te.starts_at IS NOT NULL
       AND te.starts_at >= ?
       AND i.archived_at IS NULL
     ORDER BY te.starts_at ASC, te.id ASC
     LIMIT ?`,
    nowIso(),
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

export function countUpcomingEvents(): number {
  return count(
    `SELECT count(*) FROM timeline_events te
     JOIN items i ON i.id = te.item_id
     WHERE te.superseded_by IS NULL AND te.starts_at IS NOT NULL AND te.starts_at >= ?
       AND i.archived_at IS NULL`,
    nowIso()
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

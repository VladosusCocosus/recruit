import type {
  CloseReason,
  Item,
  ItemDetail,
  ItemInput,
  ItemPatch,
  ItemQuery,
  ItemSummary,
  MessageSummary,
  Status,
  TimelineEvent,
  TimelineEventSource
} from '@shared/types'
import { count, execute, likeTerm, queryAll, queryOne, transact } from '../connection'
import {
  nowIso,
  rowToItem,
  rowToItemSummary,
  rowToMessageSummary,
  rowToStatus,
  type ItemRow,
  type ItemSummaryRow,
  type MessageRow,
  type StatusRow
} from '../rows'
import { addEvent, listTimeline, nextEventsFor } from './timeline'

/** Compact row the agent sees from `list_items` / `search_items`. No bodies, no timeline. */
export interface ItemDigest {
  id: number
  company: string
  companyDomain: string | null
  role: string | null
  location: string | null
  statusKey: string
  closeReason: CloseReason | null
  jobUrl: string | null
  source: string | null
  updatedAt: string
  archived: boolean
  messageCount: number
  nextEventAt: string | null
}

export interface SetItemStatusOptions {
  /** Write a `status_change` timeline event alongside the update. Default true. */
  recordEvent?: boolean
  source?: TimelineEventSource
}

/* ── statuses ───────────────────────────────────────────────────────────── */

export function listStatuses(): Status[] {
  return queryAll<StatusRow>('SELECT * FROM statuses ORDER BY sort_order, id').map(rowToStatus)
}

export function getStatusByKey(key: string): Status | null {
  const row = queryOne<StatusRow>('SELECT * FROM statuses WHERE key = ?', key)
  return row ? rowToStatus(row) : null
}

export function getStatusById(statusId: number): Status | null {
  const row = queryOne<StatusRow>('SELECT * FROM statuses WHERE id = ?', statusId)
  return row ? rowToStatus(row) : null
}

function requireStatus(key: string): Status {
  const status = getStatusByKey(key)
  if (!status) throw new Error(`Unknown status key "${key}"`)
  return status
}

/* ── reads ──────────────────────────────────────────────────────────────── */

const ITEM_COLUMNS = 'i.*, s.key AS status_key'

/**
 * The link rows outlive a local delete (migration 003) — nothing about deleting a message
 * un-links it from the item. So every message count here joins `messages` and skips the deleted
 * ones, or the badge would promise more mail than listItemMessages can show.
 */
const LINKED_MESSAGE_COUNT = `(SELECT count(*) FROM item_messages im
     JOIN messages m ON m.id = im.message_id
     WHERE im.item_id = i.id AND m.deleted_at IS NULL)`

/**
 * Same filter, same reason: lastMessageAt and the mail half of lastContactAt answer "when did
 * this company last write", and a message the user deleted is not an answer to that. Left
 * unfiltered, a card would keep quoting the date of mail its own message_count no longer counts
 * — the exact disagreement lastContactAt was introduced to end.
 */
const LAST_LINKED_MESSAGE_AT = `(SELECT max(m.date_utc) FROM item_messages im
     JOIN messages m ON m.id = im.message_id
     WHERE im.item_id = i.id AND m.deleted_at IS NULL)`

const SUMMARY_COLUMNS = `${ITEM_COLUMNS},
  ${LINKED_MESSAGE_COUNT} AS message_count,
  (SELECT count(*) FROM timeline_events te
     WHERE te.item_id = i.id AND te.superseded_by IS NULL) AS event_count,
  ${LAST_LINKED_MESSAGE_AT} AS last_message_at,
  NULLIF(
    max(
      COALESCE(${LAST_LINKED_MESSAGE_AT}, ''),
      COALESCE((SELECT max(COALESCE(te.occurred_at, te.starts_at)) FROM timeline_events te
                 WHERE te.item_id = i.id AND te.superseded_by IS NULL), '')
    ),
    ''
  ) AS last_contact_at,
  max(
    COALESCE((SELECT max(COALESCE(te.occurred_at, te.starts_at, te.created_at))
              FROM timeline_events te
              WHERE te.item_id = i.id AND te.superseded_by IS NULL), i.updated_at),
    i.updated_at
  ) AS last_activity_at`

const FROM = 'FROM items i JOIN statuses s ON s.id = i.status_id'

function buildWhere(query: ItemQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (!query.includeArchived) clauses.push('i.archived_at IS NULL')
  if (query.statusKey) {
    clauses.push('s.key = ?')
    params.push(query.statusKey)
  }
  if (query.query) {
    const term = likeTerm(query.query)
    clauses.push(
      `(i.company LIKE ? ESCAPE '\\' OR i.company_domain LIKE ? ESCAPE '\\' OR i.role LIKE ? ESCAPE '\\')`
    )
    params.push(term, term, term)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

/** Board / list rows, including nextEvent (one extra query for the whole page). */
export function listItems(query: ItemQuery = {}): ItemSummary[] {
  const where = buildWhere(query)
  const rows = queryAll<ItemSummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} ${FROM} ${where.sql}
     ORDER BY s.sort_order ASC, last_activity_at DESC, i.id DESC
     LIMIT ?`,
    ...where.params,
    query.limit ?? 500
  )
  const next = nextEventsFor(rows.map((r) => r.id))
  return rows.map((row) => rowToItemSummary(row, next.get(row.id) ?? null))
}

/** Plain item row. ProposalCard.item and the applier use this. */
export function getItem(itemId: number): Item | null {
  const row = queryOne<ItemRow>(`SELECT ${ITEM_COLUMNS} ${FROM} WHERE i.id = ?`, itemId)
  return row ? rowToItem(row) : null
}

export function getItemSummary(itemId: number): ItemSummary | null {
  const row = queryOne<ItemSummaryRow>(`SELECT ${SUMMARY_COLUMNS} ${FROM} WHERE i.id = ?`, itemId)
  if (!row) return null
  return rowToItemSummary(row, nextEventsFor([itemId]).get(itemId) ?? null)
}

/** The Item detail view: summary + full timeline + linked message summaries. */
export function getItemWithTimeline(itemId: number): ItemDetail | null {
  const summary = getItemSummary(itemId)
  if (!summary) return null
  return { ...summary, timeline: listTimeline(itemId), messages: listItemMessages(itemId) }
}

export function listItemMessages(itemId: number): MessageSummary[] {
  return queryAll<MessageRow>(
    `SELECT m.id, m.account_id, m.folder, m.uid, m.uid_validity, m.message_id, m.in_reply_to,
            m.references_json, m.thread_key, m.from_name, m.from_addr, m.from_domain, m.to_json,
            m.cc_json, m.subject, m.date_utc, m.snippet, m.list_unsubscribe, m.has_attachments,
            m.flags_json, m.prefilter_score, m.prefilter_reasons_json, m.triage_state, m.read_at,
            m.fetched_at,
            (SELECT group_concat(im2.item_id) FROM item_messages im2 WHERE im2.message_id = m.id)
              AS linked_item_ids
     FROM item_messages im JOIN messages m ON m.id = im.message_id
     WHERE im.item_id = ? AND m.deleted_at IS NULL
     ORDER BY m.date_utc DESC, m.id DESC`,
    itemId
  ).map(rowToMessageSummary)
}

/** Compact digest for the agent. `list_items(status?, query?)`. */
export function listItemsDigest(query: ItemQuery = {}): ItemDigest[] {
  const where = buildWhere(query)
  const rows = queryAll<{
    id: number
    company: string
    company_domain: string | null
    role: string | null
    location: string | null
    status_key: string
    close_reason: string | null
    job_url: string | null
    source: string | null
    updated_at: string
    archived_at: string | null
    message_count: number
    next_event_at: string | null
  }>(
    `SELECT i.id, i.company, i.company_domain, i.role, i.location, s.key AS status_key,
            i.close_reason, i.job_url, i.source, i.updated_at, i.archived_at,
            ${LINKED_MESSAGE_COUNT} AS message_count,
            (SELECT min(te.starts_at) FROM timeline_events te
               WHERE te.item_id = i.id AND te.superseded_by IS NULL
                 AND te.starts_at IS NOT NULL AND te.starts_at >= ?) AS next_event_at
     ${FROM} ${where.sql}
     ORDER BY i.updated_at DESC, i.id DESC
     LIMIT ?`,
    nowIso(),
    ...where.params,
    query.limit ?? 200
  )
  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    companyDomain: r.company_domain,
    role: r.role,
    location: r.location,
    statusKey: r.status_key,
    closeReason: r.close_reason as CloseReason | null,
    jobUrl: r.job_url,
    source: r.source,
    updatedAt: r.updated_at,
    archived: r.archived_at !== null,
    messageCount: r.message_count,
    nextEventAt: r.next_event_at
  }))
}

/** `search_items(query)` — company / company_domain / role. */
export function searchItems(query: string, limit = 50): ItemDigest[] {
  return listItemsDigest({ query, includeArchived: true, limit })
}

/** Domains of every live item — one half of the prefilter context. */
export function listItemDomains(): string[] {
  return queryAll<{ d: string }>(
    `SELECT DISTINCT lower(company_domain) AS d FROM items
     WHERE company_domain IS NOT NULL AND company_domain <> '' AND archived_at IS NULL`
  ).map((r) => r.d)
}

export function countItems(includeArchived = false): number {
  return includeArchived
    ? count('SELECT count(*) FROM items')
    : count('SELECT count(*) FROM items WHERE archived_at IS NULL')
}

/* ── writes ─────────────────────────────────────────────────────────────── */

export function createItem(input: ItemInput): Item {
  const status = requireStatus(input.statusKey ?? 'saved')
  const now = nowIso()
  const info = execute(
    `INSERT INTO items (
       company, company_domain, role, location, work_mode, source, job_url,
       compensation_note, status_id, close_reason, description_md, description_source,
       description_updated_at, contact_name, contact_email, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    input.company,
    input.companyDomain ?? null,
    input.role ?? null,
    input.location ?? null,
    input.workMode ?? null,
    input.source ?? null,
    input.jobUrl ?? null,
    input.compensationNote ?? null,
    status.id,
    input.descriptionMd ?? null,
    input.descriptionMd ? (input.descriptionSource ?? 'user') : null,
    input.descriptionMd ? now : null,
    input.contactName ?? null,
    input.contactEmail ?? null,
    now,
    now
  )
  return getItem(Number(info.lastInsertRowid)) as Item
}

/**
 * Undefined fields are untouched; explicit nulls clear. Touching descriptionMd stamps
 * description_updated_at and (unless overridden) flips ownership to the editor —
 * that is what backs the "written by Claude · edit to take ownership" note.
 */
export function updateItem(itemId: number, patch: ItemPatch): Item {
  const sets: string[] = []
  const params: unknown[] = []
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.company !== undefined) put('company', patch.company)
  if (patch.companyDomain !== undefined) put('company_domain', patch.companyDomain)
  if (patch.role !== undefined) put('role', patch.role)
  if (patch.location !== undefined) put('location', patch.location)
  if (patch.workMode !== undefined) put('work_mode', patch.workMode)
  if (patch.source !== undefined) put('source', patch.source)
  if (patch.jobUrl !== undefined) put('job_url', patch.jobUrl)
  if (patch.compensationNote !== undefined) put('compensation_note', patch.compensationNote)
  if (patch.contactName !== undefined) put('contact_name', patch.contactName)
  if (patch.contactEmail !== undefined) put('contact_email', patch.contactEmail)
  if (patch.closeReason !== undefined) put('close_reason', patch.closeReason)
  if (patch.statusKey !== undefined) put('status_id', requireStatus(patch.statusKey).id)
  if (patch.descriptionMd !== undefined) {
    put('description_md', patch.descriptionMd)
    put('description_source', patch.descriptionSource ?? 'user')
    put('description_updated_at', nowIso())
  } else if (patch.descriptionSource !== undefined) {
    put('description_source', patch.descriptionSource)
  }

  put('updated_at', nowIso())
  params.push(itemId)
  execute(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, ...params)

  const item = getItem(itemId)
  if (!item) throw new Error(`Item ${itemId} not found`)
  return item
}

/**
 * Status change + (by default) the matching `status_change` timeline event.
 * Returns the event too, because the proposal applier reports createdEventId.
 */
export function setItemStatusWithEvent(
  itemId: number,
  statusKey: string,
  closeReason: CloseReason | null = null,
  options: SetItemStatusOptions = {}
): { item: Item; event: TimelineEvent | null } {
  return transact(() => {
    const before = getItem(itemId)
    if (!before) throw new Error(`Item ${itemId} not found`)
    const status = requireStatus(statusKey)
    const reason = status.kind === 'closed' ? closeReason : null

    execute(
      'UPDATE items SET status_id = ?, close_reason = ?, updated_at = ? WHERE id = ?',
      status.id,
      reason,
      nowIso(),
      itemId
    )

    let event: TimelineEvent | null = null
    if (options.recordEvent !== false && before.statusKey !== statusKey) {
      const fromLabel = getStatusById(before.statusId)?.label ?? before.statusKey
      event = addEvent({
        itemId,
        kind: 'status_change',
        title: `${fromLabel} → ${status.label}${reason ? ` (${reason})` : ''}`,
        occurredAt: nowIso(),
        source: options.source ?? 'user'
      })
    }
    return { item: getItem(itemId) as Item, event }
  })
}

/** IPC shape: `setItemStatus(itemId, statusKey, closeReason?) -> Item`. */
export function setItemStatus(
  itemId: number,
  statusKey: string,
  closeReason: CloseReason | null = null,
  options: SetItemStatusOptions = {}
): Item {
  return setItemStatusWithEvent(itemId, statusKey, closeReason, options).item
}

export function archiveItem(itemId: number, archived: boolean): Item {
  execute(
    'UPDATE items SET archived_at = ?, updated_at = ? WHERE id = ?',
    archived ? nowIso() : null,
    nowIso(),
    itemId
  )
  const item = getItem(itemId)
  if (!item) throw new Error(`Item ${itemId} not found`)
  return item
}

export function deleteItem(itemId: number): void {
  execute('DELETE FROM items WHERE id = ?', itemId)
}

/* ── item <-> message links ─────────────────────────────────────────────── */

export function linkMessage(itemId: number, messageId: number): void {
  transact(() => {
    execute(
      'INSERT OR IGNORE INTO item_messages (item_id, message_id) VALUES (?, ?)',
      itemId,
      messageId
    )
    execute("UPDATE messages SET triage_state = 'linked' WHERE id = ?", messageId)
    execute('UPDATE items SET updated_at = ? WHERE id = ?', nowIso(), itemId)
  })
}

export function unlinkMessage(itemId: number, messageId: number): void {
  transact(() => {
    execute('DELETE FROM item_messages WHERE item_id = ? AND message_id = ?', itemId, messageId)
    const remaining = count(
      'SELECT count(*) FROM item_messages WHERE message_id = ?',
      messageId
    )
    if (remaining === 0) {
      execute(
        "UPDATE messages SET triage_state = 'processed' WHERE id = ? AND triage_state = 'linked'",
        messageId
      )
    }
    execute('UPDATE items SET updated_at = ? WHERE id = ?', nowIso(), itemId)
  })
}

export function listLinkedItemIds(messageId: number): number[] {
  return queryAll<{ item_id: number }>(
    'SELECT item_id FROM item_messages WHERE message_id = ? ORDER BY item_id',
    messageId
  ).map((r) => r.item_id)
}

export function isMessageLinked(itemId: number, messageId: number): boolean {
  return (
    count(
      'SELECT count(*) FROM item_messages WHERE item_id = ? AND message_id = ?',
      itemId,
      messageId
    ) > 0
  )
}

/** Items whose company_domain matches — the applier uses it to avoid duplicate creates. */
export function findItemsByDomain(companyDomain: string): Item[] {
  return queryAll<ItemRow>(
    `SELECT ${ITEM_COLUMNS} ${FROM} WHERE lower(i.company_domain) = lower(?) AND i.archived_at IS NULL
     ORDER BY i.updated_at DESC`,
    companyDomain
  ).map(rowToItem)
}

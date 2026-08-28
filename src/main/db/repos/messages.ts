import type {
  Attachment,
  EmailAddress,
  Message,
  MessageListPage,
  MessageQuery,
  MessageSummary,
  PrefilterMessage,
  PrefilterReason,
  TriageState
} from '@shared/types'
import { count, execute, likeTerm, placeholders, queryAll, queryOne, transact } from '../connection'
import {
  nowIso,
  rowToAttachment,
  rowToMessage,
  rowToMessageSummary,
  toInt,
  toJson,
  type AttachmentRow,
  type MessageRow
} from '../rows'

/* ── write shapes ───────────────────────────────────────────────────────── */

export interface AttachmentInput {
  filename?: string | null
  mimeType?: string | null
  size?: number | null
  contentId?: string | null
  diskPath?: string | null
  isCalendar?: boolean
}

/** What the IMAP sync hands over per message. `*_json` columns take real values here. */
export interface MessageUpsertInput {
  accountId: number
  folder: string
  uid: number
  uidValidity: number
  messageId?: string | null
  inReplyTo?: string | null
  references?: string[]
  threadKey?: string | null
  fromName?: string | null
  fromAddr?: string | null
  fromDomain?: string | null
  to?: EmailAddress[]
  cc?: EmailAddress[]
  subject?: string | null
  dateUtc?: string | null
  snippet?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  listUnsubscribe?: string | null
  hasAttachments?: boolean
  flags?: string[]
  prefilterScore?: number | null
  prefilterReasons?: PrefilterReason[]
  /** Omit on re-fetch to preserve whatever triage state the user/agent already set. */
  triageState?: TriageState
  attachments?: AttachmentInput[]
}

export interface UpsertMessageResult {
  id: number
  created: boolean
}

/** id + exactly the fields the prefilter is allowed to read. */
export type PrefilterInput = PrefilterMessage & { id: number }

/* ── column lists ───────────────────────────────────────────────────────── */

const LINKED = '(SELECT group_concat(im.item_id) FROM item_messages im WHERE im.message_id = m.id) AS linked_item_ids'

/**
 * A soft-deleted message does not exist as far as reads are concerned (migration 003). Every
 * query here that can put a message — or a count of messages — in front of the user or the
 * agent carries this. The two that deliberately do not are maxUid() and getPrefilterContext();
 * both say why at the call site.
 */
const LIVE = 'm.deleted_at IS NULL'

/** Everything except the two body columns — the mail list must stay cheap. */
const SUMMARY_COLUMNS = `
  m.id, m.account_id, m.folder, m.uid, m.uid_validity, m.message_id, m.in_reply_to,
  m.references_json, m.thread_key, m.from_name, m.from_addr, m.from_domain, m.to_json,
  m.cc_json, m.subject, m.date_utc, m.snippet, m.list_unsubscribe, m.has_attachments,
  m.flags_json, m.prefilter_score, m.prefilter_reasons_json, m.triage_state, m.read_at,
  m.fetched_at, ${LINKED}`

const FULL_COLUMNS = `m.*, ${LINKED}`

/* ── reads ──────────────────────────────────────────────────────────────── */

/** null for a deleted message — the reader shows its "Message not available" state. */
export function getMessage(messageId: number): Message | null {
  const row = queryOne<MessageRow>(
    `SELECT ${FULL_COLUMNS} FROM messages m WHERE m.id = ? AND ${LIVE}`,
    messageId
  )
  return row ? rowToMessage(row, listAttachments(messageId)) : null
}

export function getMessageSummary(messageId: number): MessageSummary | null {
  const row = queryOne<MessageRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM messages m WHERE m.id = ? AND ${LIVE}`,
    messageId
  )
  return row ? rowToMessageSummary(row) : null
}

/**
 * Also the agent's `listRunMessages` and the review queue's ProposalCard.messages: a deleted
 * message drops out of both rather than being served from a stale id list.
 */
export function listMessagesByIds(messageIds: number[]): MessageSummary[] {
  if (!messageIds.length) return []
  return queryAll<MessageRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM messages m
     WHERE m.id IN (${placeholders(messageIds.length)}) AND ${LIVE}
     ORDER BY m.date_utc DESC, m.id DESC`,
    ...messageIds
  ).map(rowToMessageSummary)
}

interface WhereParts {
  sql: string
  params: unknown[]
}

function buildWhere(query: MessageQuery): WhereParts {
  // Unconditional, and first: MessageQuery has no way to ask for deleted mail, so both the
  // page and the `total` it is counted against are always over live rows.
  const clauses: string[] = [LIVE]
  const params: unknown[] = []

  if (query.accountId !== undefined) {
    clauses.push('m.account_id = ?')
    params.push(query.accountId)
  }
  if (query.folder !== undefined) {
    clauses.push('m.folder = ?')
    params.push(query.folder)
  }
  if (query.triageState !== undefined) {
    const states = Array.isArray(query.triageState) ? query.triageState : [query.triageState]
    if (states.length) {
      clauses.push(`m.triage_state IN (${placeholders(states.length)})`)
      params.push(...states)
    }
  }
  if (query.search) {
    const term = likeTerm(query.search)
    clauses.push(
      `(m.subject LIKE ? ESCAPE '\\' OR m.from_addr LIKE ? ESCAPE '\\'
        OR m.from_name LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\')`
    )
    params.push(term, term, term, term)
  }
  if (query.minScore !== undefined) {
    clauses.push('m.prefilter_score >= ?')
    params.push(query.minScore)
  }
  if (query.unlinkedOnly) {
    clauses.push('NOT EXISTS (SELECT 1 FROM item_messages im2 WHERE im2.message_id = m.id)')
  }

  return { sql: `WHERE ${clauses.join(' AND ')}`, params }
}

export function listMessages(query: MessageQuery = {}): MessageListPage {
  const where = buildWhere(query)
  const limit = query.limit ?? 200
  const offset = query.offset ?? 0

  const total = count(`SELECT count(*) FROM messages m ${where.sql}`, ...where.params)
  const rows = queryAll<MessageRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM messages m ${where.sql}
     ORDER BY m.date_utc DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    ...where.params,
    limit,
    offset
  )
  return { rows: rows.map(rowToMessageSummary), total, limit, offset }
}

/** The RUN button's input: everything the prefilter flagged, best score first. */
export function listCandidates(limit = 200): MessageSummary[] {
  return queryAll<MessageRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM messages m
     WHERE m.triage_state = 'candidate' AND ${LIVE}
     ORDER BY m.prefilter_score DESC, m.date_utc DESC, m.id DESC
     LIMIT ?`,
    limit
  ).map(rowToMessageSummary)
}

export function listAttachments(messageId: number): Attachment[] {
  return queryAll<AttachmentRow>(
    'SELECT * FROM attachments WHERE message_id = ? ORDER BY id',
    messageId
  ).map(rowToAttachment)
}

export function countMessages(accountId?: number): number {
  return accountId === undefined
    ? count(`SELECT count(*) FROM messages m WHERE ${LIVE}`)
    : count(`SELECT count(*) FROM messages m WHERE ${LIVE} AND m.account_id = ?`, accountId)
}

export function countCandidates(): number {
  return count(`SELECT count(*) FROM messages m WHERE m.triage_state = 'candidate' AND ${LIVE}`)
}

export function countByTriageState(state: TriageState): number {
  return count(`SELECT count(*) FROM messages m WHERE m.triage_state = ? AND ${LIVE}`, state)
}

/**
 * Unread = the \Seen flag is absent AND the user has not opened it here. flags_json holds a
 * JSON array, so the escaped flag reads as "\\Seen" in the stored text — match on the bare
 * word. Must stay in step with rowToMessageSummary's isUnread, which the rail badge is
 * counting rows for.
 *
 * Deleting an unread message drops it out of this count, which is why the optimistic patch in
 * useMessages has to concede the badge the same way.
 */
export function countUnread(accountId?: number): number {
  const scope = accountId === undefined ? '' : 'AND m.account_id = ?'
  const params = accountId === undefined ? [] : [accountId]
  return count(
    `SELECT count(*) FROM messages m
     WHERE m.read_at IS NULL AND (m.flags_json IS NULL OR m.flags_json NOT LIKE '%Seen%')
       AND ${LIVE} ${scope}`,
    ...params
  )
}

/**
 * Highest UID stored for a folder — the IMAP sync resumes from here. Deliberately counts
 * deleted rows: this is a position in the server's UID space, not a message the user can see,
 * and skipping a deleted UID would make every poll re-fetch it forever.
 */
export function maxUid(accountId: number, folder: string, uidValidity: number): number | null {
  const row = queryOne<{ max_uid: number | null }>(
    `SELECT MAX(uid) AS max_uid FROM messages
     WHERE account_id = ? AND folder = ? AND uid_validity = ?`,
    accountId,
    folder,
    uidValidity
  )
  return row?.max_uid ?? null
}

/* ── writes ─────────────────────────────────────────────────────────────── */

export function replaceAttachments(messageId: number, attachments: AttachmentInput[]): void {
  execute('DELETE FROM attachments WHERE message_id = ?', messageId)
  for (const a of attachments) {
    execute(
      `INSERT INTO attachments (message_id, filename, mime_type, size, content_id, disk_path, is_calendar)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      messageId,
      a.filename ?? null,
      a.mimeType ?? null,
      a.size ?? null,
      a.contentId ?? null,
      a.diskPath ?? null,
      toInt(a.isCalendar) ?? 0
    )
  }
}

/**
 * Idempotent on (account_id, folder, uid_validity, uid).
 *
 * On re-fetch, omitted fields are PRESERVED (COALESCE), not cleared — an envelope-only
 * pass followed by a body-only pass is a normal IMAP pattern and must not lose data.
 * triage_state is likewise kept unless the caller explicitly sets one.
 *
 * read_at and deleted_at are not in the UPDATE at all, on purpose: a re-fetch refreshes
 * flags_json, and if it also cleared the local state every sync pass would turn the whole inbox
 * unread again and undelete everything the user deleted. That is not hypothetical for
 * deleted_at — MailSync re-fetches the entire backfill window whenever lastUid is 0 (a fresh
 * account row, or a UIDVALIDITY reset), and each of those re-fetches lands here as an UPDATE on
 * the existing (account_id, folder, uid_validity, uid) row. Deleted stays deleted.
 */
export function upsertMessage(input: MessageUpsertInput): UpsertMessageResult {
  return transact(() => {
    const existing = queryOne<{ id: number; triage_state: string }>(
      `SELECT id, triage_state FROM messages
       WHERE account_id = ? AND folder = ? AND uid_validity = ? AND uid = ?`,
      input.accountId,
      input.folder,
      input.uidValidity,
      input.uid
    )

    // null == "not supplied" for every one of these.
    const values = [
      input.messageId ?? null,
      input.inReplyTo ?? null,
      input.references ? toJson(input.references) : null,
      input.threadKey ?? null,
      input.fromName ?? null,
      input.fromAddr ?? null,
      input.fromDomain ?? null,
      input.to ? toJson(input.to) : null,
      input.cc ? toJson(input.cc) : null,
      input.subject ?? null,
      input.dateUtc ?? null,
      input.snippet ?? null,
      input.bodyText ?? null,
      input.bodyHtml ?? null,
      input.listUnsubscribe ?? null,
      toInt(input.hasAttachments),
      input.flags ? toJson(input.flags) : null,
      input.prefilterScore ?? null,
      input.prefilterReasons ? toJson(input.prefilterReasons) : null
    ]

    let id: number
    let created: boolean
    if (existing) {
      execute(
        `UPDATE messages SET
           message_id = COALESCE(?, message_id),
           in_reply_to = COALESCE(?, in_reply_to),
           references_json = COALESCE(?, references_json),
           thread_key = COALESCE(?, thread_key),
           from_name = COALESCE(?, from_name),
           from_addr = COALESCE(?, from_addr),
           from_domain = COALESCE(?, from_domain),
           to_json = COALESCE(?, to_json),
           cc_json = COALESCE(?, cc_json),
           subject = COALESCE(?, subject),
           date_utc = COALESCE(?, date_utc),
           snippet = COALESCE(?, snippet),
           body_text = COALESCE(?, body_text),
           body_html = COALESCE(?, body_html),
           list_unsubscribe = COALESCE(?, list_unsubscribe),
           has_attachments = COALESCE(?, has_attachments),
           flags_json = COALESCE(?, flags_json),
           prefilter_score = COALESCE(?, prefilter_score),
           prefilter_reasons_json = COALESCE(?, prefilter_reasons_json),
           triage_state = ?,
           fetched_at = ?
         WHERE id = ?`,
        ...values,
        input.triageState ?? existing.triage_state,
        nowIso(),
        existing.id
      )
      id = existing.id
      created = false
    } else {
      const info = execute(
        `INSERT INTO messages (
           account_id, folder, uid, uid_validity,
           message_id, in_reply_to, references_json, thread_key,
           from_name, from_addr, from_domain, to_json, cc_json,
           subject, date_utc, snippet, body_text, body_html,
           list_unsubscribe, has_attachments, flags_json,
           prefilter_score, prefilter_reasons_json, triage_state, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.accountId,
        input.folder,
        input.uid,
        input.uidValidity,
        ...values.slice(0, 15),
        values[15] ?? 0,
        values[16] ?? '[]',
        values[17],
        values[18],
        input.triageState ?? 'unseen',
        nowIso()
      )
      id = Number(info.lastInsertRowid)
      created = true
    }

    if (input.attachments) replaceAttachments(id, input.attachments)
    return { id, created }
  })
}

export function setTriageState(messageIds: number[], state: TriageState): void {
  if (!messageIds.length) return
  execute(
    `UPDATE messages SET triage_state = ? WHERE id IN (${placeholders(messageIds.length)})`,
    state,
    ...messageIds
  )
}

/**
 * The local read state, and the only writer of read_at. v1 never touches IMAP flags, so
 * marking a message unread again cannot un-set \Seen — it just clears this column, and a
 * message the server already reports as seen stays read.
 */
export function markMessagesRead(messageIds: number[], read: boolean): void {
  if (!messageIds.length) return
  execute(
    `UPDATE messages SET read_at = ? WHERE id IN (${placeholders(messageIds.length)})`,
    read ? nowIso() : null,
    ...messageIds
  )
}

/**
 * The local delete, and the only writer of deleted_at. Soft by construction: the row, its
 * attachments and every foreign key into it (item_messages, agent_run_messages, proposals)
 * survive untouched, so `deleted = false` is a complete undo and nothing downstream ever sees
 * a dangling id. The server is not told — v1 mail is read-only, and the message is still in
 * the mailbox on the next device.
 */
export function deleteMessages(messageIds: number[], deleted: boolean): void {
  if (!messageIds.length) return
  execute(
    `UPDATE messages SET deleted_at = ? WHERE id IN (${placeholders(messageIds.length)})`,
    deleted ? nowIso() : null,
    ...messageIds
  )
}

/**
 * Stores a prefilter verdict. Only moves the message between 'unseen' and 'candidate' —
 * a message the user or the agent already handled keeps its state.
 */
export function setPrefilterResult(
  messageId: number,
  score: number,
  reasons: PrefilterReason[],
  isCandidate: boolean
): void {
  execute(
    `UPDATE messages SET
       prefilter_score = ?,
       prefilter_reasons_json = ?,
       triage_state = CASE
         WHEN triage_state IN ('processed', 'dismissed', 'linked') THEN triage_state
         WHEN ? = 1 THEN 'candidate'
         ELSE 'unseen'
       END
     WHERE id = ?`,
    score,
    toJson(reasons),
    isCandidate ? 1 : 0,
    messageId
  )
}

/* ── prefilter feed ─────────────────────────────────────────────────────── */

/** Every live message id, oldest first. Chunk these into getPrefilterInputs for a rescore. */
export function listMessageIdsForPrefilter(): number[] {
  return queryAll<{ id: number }>(`SELECT m.id FROM messages m WHERE ${LIVE} ORDER BY m.id`).map(
    (r) => r.id
  )
}

/**
 * Exactly the columns PrefilterMessage exposes — nothing wider reaches the scorer. Ids come
 * from listMessageIdsForPrefilter, which is already filtered; carrying the filter here too
 * means a caller-supplied list cannot feed a deleted body back into scoring either.
 */
export function getPrefilterInputs(messageIds: number[]): PrefilterInput[] {
  if (!messageIds.length) return []
  const marks = placeholders(messageIds.length)
  const rows = queryAll<{
    id: number
    from_addr: string | null
    from_domain: string | null
    subject: string | null
    body_text: string | null
    body_html: string | null
    thread_key: string | null
    list_unsubscribe: string | null
  }>(
    `SELECT m.id, m.from_addr, m.from_domain, m.subject, m.body_text, m.body_html, m.thread_key,
            m.list_unsubscribe
     FROM messages m WHERE m.id IN (${marks}) AND ${LIVE}`,
    ...messageIds
  )
  const attachments = queryAll<{
    message_id: number
    filename: string | null
    mime_type: string | null
    is_calendar: number
  }>(
    `SELECT message_id, filename, mime_type, is_calendar FROM attachments
     WHERE message_id IN (${marks})`,
    ...messageIds
  )

  const byMessage = new Map<number, PrefilterMessage['attachments']>()
  for (const a of attachments) {
    const list = byMessage.get(a.message_id) ?? []
    list.push({ filename: a.filename, mimeType: a.mime_type, isCalendar: a.is_calendar !== 0 })
    byMessage.set(a.message_id, list)
  }

  return rows.map((row) => ({
    id: row.id,
    fromAddr: row.from_addr,
    fromDomain: row.from_domain,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    threadKey: row.thread_key,
    listUnsubscribe: row.list_unsubscribe,
    attachments: byMessage.get(row.id) ?? []
  }))
}

/** Convenience for a full rescore. Prefer chunking with getPrefilterInputs on big mailboxes. */
export function listMessagesForPrefilter(): PrefilterInput[] {
  return getPrefilterInputs(listMessageIdsForPrefilter())
}

/**
 * The two live signal sets the prefilter scores against. Satisfies PrefilterContext.
 *
 * Deliberately does not filter deleted_at: these are the domains and threads the user has
 * TRACKED, and deleting one message out of a linked thread is not a statement that the thread
 * stopped mattering. Nothing here is a message — only strings the scorer matches against.
 */
export function getPrefilterContext(): {
  itemDomains: Set<string>
  linkedThreadKeys: Set<string>
} {
  const itemDomains = new Set(
    queryAll<{ d: string }>(
      `SELECT DISTINCT lower(company_domain) AS d FROM items
       WHERE company_domain IS NOT NULL AND company_domain <> '' AND archived_at IS NULL`
    ).map((r) => r.d)
  )
  const linkedThreadKeys = new Set(
    queryAll<{ k: string }>(
      `SELECT DISTINCT m.thread_key AS k
       FROM item_messages im JOIN messages m ON m.id = im.message_id
       WHERE m.thread_key IS NOT NULL AND m.thread_key <> ''`
    ).map((r) => r.k)
  )
  return { itemDomains, linkedThreadKeys }
}

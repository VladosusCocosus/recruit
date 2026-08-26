/**
 * Row shapes (snake_case, exactly as stored) and the ONLY row -> domain mappers in the app.
 * Nobody outside src/main/db hand-maps a SQLite row. See src/shared/types.ts convention #1.
 */
import { classifyAgentErrorFacts } from '@shared/agentErrors'
import {
  type Account,
  type AgentEnvelope,
  type AgentErrorKind,
  type AgentRun,
  type AgentRunKind,
  type AgentRunSummary,
  type Attachment,
  type CloseReason,
  type DescriptionSource,
  type EmailAddress,
  type Item,
  type ItemSummary,
  type Message,
  type MessageSummary,
  type PrefilterReason,
  type Proposal,
  type ProposalKind,
  type ProposalPayloadMap,
  type ProposalState,
  type Status,
  type StatusKind,
  type TimelineEvent,
  type TimelineEventKind,
  type TimelineEventSource,
  type TriageState,
  type WorkMode
} from '@shared/types'

/* ── json / boolean helpers ─────────────────────────────────────────────── */

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback
  try {
    const parsed = JSON.parse(text) as T
    return parsed == null ? fallback : parsed
  } catch {
    return fallback
  }
}

export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

/** TS boolean -> SQLite 0/1. Preserves null. */
export function toInt(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return value ? 1 : 0
}

/** SQLite 0/1 -> TS boolean. Preserves null. */
export function toBool(value: number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null
  return value !== 0
}

/** Split a group_concat(id) result into numbers. */
export function splitIds(text: string | null | undefined): number[] {
  if (!text) return []
  const out: number[] = []
  for (const part of text.split(',')) {
    const n = Number(part)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

export const nowIso = (): string => new Date().toISOString()

/* ── accounts ───────────────────────────────────────────────────────────── */

export interface AccountRow {
  id: number
  email: string
  display_name: string | null
  imap_host: string
  imap_port: number
  imap_secure: number
  imap_user: string
  smtp_host: string | null
  smtp_port: number | null
  smtp_secure: number | null
  smtp_user: string | null
  keychain_ref_imap: string | null
  keychain_ref_smtp: string | null
  last_uid_validity: number | null
  last_uid: number | null
  created_at: string
}

export function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure !== 0,
    imapUser: row.imap_user,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: toBool(row.smtp_secure),
    smtpUser: row.smtp_user,
    keychainRefImap: row.keychain_ref_imap,
    keychainRefSmtp: row.keychain_ref_smtp,
    lastUidValidity: row.last_uid_validity,
    lastUid: row.last_uid,
    createdAt: row.created_at
  }
}

/* ── attachments ────────────────────────────────────────────────────────── */

export interface AttachmentRow {
  id: number
  message_id: number
  filename: string | null
  mime_type: string | null
  size: number | null
  content_id: string | null
  disk_path: string | null
  is_calendar: number
}

export function rowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    contentId: row.content_id,
    diskPath: row.disk_path,
    isCalendar: row.is_calendar !== 0
  }
}

/* ── messages ───────────────────────────────────────────────────────────── */

export interface MessageRow {
  id: number
  account_id: number
  folder: string
  uid: number
  uid_validity: number
  message_id: string | null
  in_reply_to: string | null
  references_json: string | null
  thread_key: string | null
  from_name: string | null
  from_addr: string | null
  from_domain: string | null
  to_json: string | null
  cc_json: string | null
  subject: string | null
  date_utc: string | null
  snippet: string | null
  body_text: string | null
  body_html: string | null
  list_unsubscribe: string | null
  has_attachments: number
  flags_json: string | null
  prefilter_score: number | null
  prefilter_reasons_json: string | null
  triage_state: string
  fetched_at: string
  /** group_concat(item_messages.item_id) — always selected by the message queries. */
  linked_item_ids?: string | null
}

export function rowToMessageSummary(row: MessageRow): MessageSummary {
  const flags = parseJson<string[]>(row.flags_json, [])
  return {
    id: row.id,
    accountId: row.account_id,
    folder: row.folder,
    uid: row.uid,
    uidValidity: row.uid_validity,
    threadKey: row.thread_key,
    fromName: row.from_name,
    fromAddr: row.from_addr,
    fromDomain: row.from_domain,
    subject: row.subject,
    dateUtc: row.date_utc,
    snippet: row.snippet,
    hasAttachments: row.has_attachments !== 0,
    flags,
    isUnread: !flags.includes('\\Seen'),
    prefilterScore: row.prefilter_score,
    prefilterReasons: parseJson<PrefilterReason[]>(row.prefilter_reasons_json, []),
    triageState: row.triage_state as TriageState,
    linkedItemIds: splitIds(row.linked_item_ids)
  }
}

export function rowToMessage(row: MessageRow, attachments: Attachment[] = []): Message {
  return {
    ...rowToMessageSummary(row),
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: parseJson<string[]>(row.references_json, []),
    to: parseJson<EmailAddress[]>(row.to_json, []),
    cc: parseJson<EmailAddress[]>(row.cc_json, []),
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    listUnsubscribe: row.list_unsubscribe,
    fetchedAt: row.fetched_at,
    attachments
  }
}

/* ── statuses ───────────────────────────────────────────────────────────── */

export interface StatusRow {
  id: number
  key: string
  label: string
  kind: string
  sort_order: number
  color: string | null
}

export function rowToStatus(row: StatusRow): Status {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    kind: row.kind as StatusKind,
    sortOrder: row.sort_order,
    color: row.color
  }
}

/* ── items ──────────────────────────────────────────────────────────────── */

export interface ItemRow {
  id: number
  company: string
  company_domain: string | null
  role: string | null
  location: string | null
  work_mode: string | null
  source: string | null
  job_url: string | null
  compensation_note: string | null
  status_id: number
  close_reason: string | null
  description_md: string | null
  description_source: string | null
  description_updated_at: string | null
  contact_name: string | null
  contact_email: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  /** Denormalized from the statuses join. Every item read joins it. */
  status_key: string
}

export interface ItemSummaryRow extends ItemRow {
  message_count: number
  event_count: number
  last_activity_at: string | null
}

export function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    company: row.company,
    companyDomain: row.company_domain,
    role: row.role,
    location: row.location,
    workMode: row.work_mode as WorkMode | null,
    source: row.source,
    jobUrl: row.job_url,
    compensationNote: row.compensation_note,
    statusId: row.status_id,
    statusKey: row.status_key,
    closeReason: row.close_reason as CloseReason | null,
    descriptionMd: row.description_md,
    descriptionSource: row.description_source as DescriptionSource | null,
    descriptionUpdatedAt: row.description_updated_at,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  }
}

export function rowToItemSummary(
  row: ItemSummaryRow,
  nextEvent: TimelineEvent | null = null
): ItemSummary {
  return {
    ...rowToItem(row),
    messageCount: row.message_count ?? 0,
    eventCount: row.event_count ?? 0,
    nextEvent,
    lastActivityAt: row.last_activity_at ?? row.updated_at
  }
}

/* ── timeline_events ────────────────────────────────────────────────────── */

export interface TimelineEventRow {
  id: number
  item_id: number
  kind: string
  title: string
  body_md: string | null
  occurred_at: string | null
  starts_at: string | null
  ends_at: string | null
  tz: string | null
  location: string | null
  meeting_url: string | null
  message_id: number | null
  ics_uid: string | null
  ics_sequence: number | null
  source: string | null
  superseded_by: number | null
  created_at: string
}

export function rowToTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    itemId: row.item_id,
    kind: row.kind as TimelineEventKind,
    title: row.title,
    bodyMd: row.body_md,
    occurredAt: row.occurred_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    tz: row.tz,
    location: row.location,
    meetingUrl: row.meeting_url,
    messageId: row.message_id,
    icsUid: row.ics_uid,
    icsSequence: row.ics_sequence,
    source: (row.source ?? 'user') as TimelineEventSource,
    supersededBy: row.superseded_by,
    createdAt: row.created_at
  }
}

/* ── proposals ──────────────────────────────────────────────────────────── */

export interface ProposalRow {
  id: number
  run_id: number
  kind: string
  ref: string | null
  target_item_id: number | null
  target_event_id: number | null
  payload_json: string | null
  confidence: number | null
  rationale: string | null
  state: string
  decided_at: string | null
  created_at: string
}

export function rowToProposal(row: ProposalRow): Proposal {
  const kind = row.kind as ProposalKind
  const payload = parseJson<ProposalPayloadMap[ProposalKind]>(
    row.payload_json,
    {} as ProposalPayloadMap[ProposalKind]
  )
  return {
    id: row.id,
    runId: row.run_id,
    kind,
    ref: row.ref,
    targetItemId: row.target_item_id,
    targetEventId: row.target_event_id,
    payload,
    confidence: row.confidence,
    rationale: row.rationale,
    state: row.state as ProposalState,
    decidedAt: row.decided_at,
    createdAt: row.created_at
    // The Proposal union is discriminated on `kind`; payload_json is written by the
    // MCP tool layer which already validated it against ProposalPayloadMap[kind].
  } as Proposal
}

/* ── agent_runs ─────────────────────────────────────────────────────────── */

export interface AgentRunRow {
  id: number
  kind: string
  started_at: string
  finished_at: string | null
  command_json: string | null
  model: string | null
  session_id: string | null
  exit_code: number | null
  is_error: number
  error_text: string | null
  duration_ms: number | null
  cost_usd: number | null
  raw_envelope_json: string | null
  /** group_concat(agent_run_messages.message_id) */
  message_ids?: string | null
  proposal_count?: number | null
}

/**
 * `errorKind` is derived at read time, never stored. The not_signed_in case is a
 * first-class UI state — see CLAUDE_NOT_SIGNED_IN_MESSAGE.
 */
export function deriveErrorKind(
  row: Pick<AgentRunRow, 'is_error' | 'error_text' | 'raw_envelope_json'>
): AgentErrorKind | null {
  return classifyAgentErrorFacts({
    errorText: row.error_text,
    envelopeResult: parseJson<AgentEnvelope | null>(row.raw_envelope_json, null)?.result ?? null,
    isError: row.is_error !== 0
  })
}

export function rowToAgentRunSummary(row: AgentRunRow): AgentRunSummary {
  return {
    id: row.id,
    kind: row.kind as AgentRunKind,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    command: parseJson<string[] | null>(row.command_json, null),
    model: row.model,
    sessionId: row.session_id,
    exitCode: row.exit_code,
    isError: row.is_error !== 0,
    errorText: row.error_text,
    errorKind: deriveErrorKind(row),
    durationMs: row.duration_ms,
    costUsd: row.cost_usd,
    proposalCount: row.proposal_count ?? 0
  }
}

export function rowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    ...rowToAgentRunSummary(row),
    rawEnvelope: parseJson<AgentEnvelope | null>(row.raw_envelope_json, null),
    messageIds: splitIds(row.message_ids)
  }
}

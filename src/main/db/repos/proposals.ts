import type {
  AgentRunSummary,
  Item,
  Proposal,
  ProposalCard,
  ProposalKind,
  ProposalPayloadMap,
  ProposalQuery,
  ProposalState
} from '@shared/types'
import { count, execute, placeholders, queryAll, queryOne } from '../connection'
import { nowIso, rowToProposal, toJson, type ProposalRow } from '../rows'
import { getItem } from './items'
import { listMessagesByIds } from './messages'
import { getRunSummary, listRunMessageIds } from './runs'

export interface ProposalInsert<K extends ProposalKind = ProposalKind> {
  runId: number
  kind: K
  /** Client-side id like "new:1", resolved to a real row by the applier. */
  ref?: string | null
  targetItemId?: number | null
  targetEventId?: number | null
  payload: ProposalPayloadMap[K]
  confidence?: number | null
  rationale?: string | null
}

const SELECT = 'SELECT * FROM proposals'

/* ── reads ──────────────────────────────────────────────────────────────── */

export function getProposal(proposalId: number): Proposal | null {
  const row = queryOne<ProposalRow>(`${SELECT} WHERE id = ?`, proposalId)
  return row ? rowToProposal(row) : null
}

export function listProposals(query: ProposalQuery = {}): Proposal[] {
  const clauses: string[] = []
  const params: unknown[] = []
  if (query.state) {
    clauses.push('state = ?')
    params.push(query.state)
  }
  if (query.runId !== undefined) {
    clauses.push('run_id = ?')
    params.push(query.runId)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return queryAll<ProposalRow>(
    `${SELECT} ${where} ORDER BY run_id DESC, id ASC LIMIT ?`,
    ...params,
    query.limit ?? 500
  ).map(rowToProposal)
}

/** The Review queue's backlog, oldest run first so a run is reviewed as a unit. */
export function listPendingProposals(limit = 500): Proposal[] {
  return queryAll<ProposalRow>(
    `${SELECT} WHERE state = 'pending' ORDER BY run_id ASC, id ASC LIMIT ?`,
    limit
  ).map(rowToProposal)
}

export function listProposalsByRef(runId: number, ref: string): Proposal[] {
  return queryAll<ProposalRow>(
    `${SELECT} WHERE run_id = ? AND ref = ? ORDER BY id`,
    runId,
    ref
  ).map(rowToProposal)
}

/**
 * The item id a previously-accepted create_item produced for this ref. Lets a second
 * accept pass resolve "new:1" even though the first pass owned the ref map.
 */
export function findItemIdForRef(runId: number, ref: string): number | null {
  const row = queryOne<{ target_item_id: number | null }>(
    `SELECT target_item_id FROM proposals
     WHERE run_id = ? AND ref = ? AND kind = 'create_item' AND state = 'accepted'
       AND target_item_id IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
    runId,
    ref
  )
  return row?.target_item_id ?? null
}

export function countPendingProposals(): number {
  return count("SELECT count(*) FROM proposals WHERE state = 'pending'")
}

export function countProposalsByRun(runId: number): number {
  return count('SELECT count(*) FROM proposals WHERE run_id = ?', runId)
}

/**
 * Review-queue cards: the proposal plus its item, its ref siblings, the run, and the
 * source messages (which carry prefilterReasons, i.e. "why was this flagged?").
 */
export function listProposalCards(query: ProposalQuery = {}): ProposalCard[] {
  const proposals = listProposals({ ...query, state: query.state ?? 'pending' })
  if (!proposals.length) return []

  const runs = new Map<number, AgentRunSummary | null>()
  const items = new Map<number, Item | null>()
  const runAllowlists = new Map<number, number[]>()
  const siblings = new Map<string, Proposal[]>()

  const cards: ProposalCard[] = []
  for (const proposal of proposals) {
    if (!runs.has(proposal.runId)) runs.set(proposal.runId, getRunSummary(proposal.runId))
    const run = runs.get(proposal.runId)
    if (!run) continue

    let item: Item | null = null
    if (proposal.targetItemId !== null) {
      if (!items.has(proposal.targetItemId)) {
        items.set(proposal.targetItemId, getItem(proposal.targetItemId))
      }
      item = items.get(proposal.targetItemId) ?? null
    }

    let related: Proposal[] = []
    if (proposal.ref) {
      const key = `${proposal.runId}:${proposal.ref}`
      if (!siblings.has(key)) siblings.set(key, listProposalsByRef(proposal.runId, proposal.ref))
      related = (siblings.get(key) ?? []).filter((p) => p.id !== proposal.id)
    }

    const messageIds = collectMessageIds([proposal, ...related])
    if (!messageIds.length) {
      if (!runAllowlists.has(proposal.runId)) {
        runAllowlists.set(proposal.runId, listRunMessageIds(proposal.runId))
      }
      messageIds.push(...(runAllowlists.get(proposal.runId) ?? []).slice(0, 25))
    }

    cards.push({ proposal, item, related, messages: listMessagesByIds(messageIds), run })
  }
  return cards
}

function collectMessageIds(proposals: Proposal[]): number[] {
  const ids = new Set<number>()
  for (const p of proposals) {
    const payload = p.payload as { message_id?: number | null }
    if (typeof payload.message_id === 'number') ids.add(payload.message_id)
  }
  return [...ids]
}

/* ── writes ─────────────────────────────────────────────────────────────── */

/** Every agent write lands here. There are no live-mutation MCP tools by design. */
export function insertProposal<K extends ProposalKind>(input: ProposalInsert<K>): Proposal {
  const info = execute(
    `INSERT INTO proposals (
       run_id, kind, ref, target_item_id, target_event_id, payload_json,
       confidence, rationale, state, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    input.runId,
    input.kind,
    input.ref ?? null,
    input.targetItemId ?? null,
    input.targetEventId ?? null,
    toJson(input.payload),
    input.confidence ?? null,
    input.rationale ?? null,
    nowIso()
  )
  return getProposal(Number(info.lastInsertRowid)) as Proposal
}

export function decideProposal(proposalId: number, state: ProposalState): Proposal {
  execute(
    'UPDATE proposals SET state = ?, decided_at = ? WHERE id = ?',
    state,
    state === 'pending' ? null : nowIso(),
    proposalId
  )
  const proposal = getProposal(proposalId)
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`)
  return proposal
}

/** Records what a proposal actually produced, so refs resolve on later accept passes. */
export function setProposalTarget(
  proposalId: number,
  target: { targetItemId?: number | null; targetEventId?: number | null }
): void {
  const sets: string[] = []
  const params: unknown[] = []
  if (target.targetItemId !== undefined) {
    sets.push('target_item_id = ?')
    params.push(target.targetItemId)
  }
  if (target.targetEventId !== undefined) {
    sets.push('target_event_id = ?')
    params.push(target.targetEventId)
  }
  if (!sets.length) return
  params.push(proposalId)
  execute(`UPDATE proposals SET ${sets.join(', ')} WHERE id = ?`, ...params)
}

/** Marks pending proposals invalidated by another decision. Returns the ids actually changed. */
export function supersedeProposals(proposalIds: number[]): number[] {
  const ids = [...new Set(proposalIds)]
  if (!ids.length) return []
  const affected = queryAll<{ id: number }>(
    `SELECT id FROM proposals WHERE state = 'pending' AND id IN (${placeholders(ids.length)})`,
    ...ids
  ).map((r) => r.id)
  if (!affected.length) return []
  execute(
    `UPDATE proposals SET state = 'superseded', decided_at = ?
     WHERE id IN (${placeholders(affected.length)})`,
    nowIso(),
    ...affected
  )
  return affected
}

/** Pending proposals that conflict with an accepted one. See applyProposal.ts. */
export function findConflictingPending(options: {
  excludeId: number
  kind: ProposalKind
  runId: number
  ref?: string | null
  itemId?: number | null
  messageId?: number | null
  icsUid?: string | null
}): number[] {
  const { excludeId, kind, runId } = options
  const rows: Array<{ id: number }> = []

  if (kind === 'create_item' && options.ref) {
    rows.push(
      ...queryAll<{ id: number }>(
        `SELECT id FROM proposals
         WHERE state = 'pending' AND run_id = ? AND ref = ? AND kind = 'create_item' AND id <> ?`,
        runId,
        options.ref,
        excludeId
      )
    )
  }
  if (kind === 'set_status' && options.itemId) {
    rows.push(
      ...queryAll<{ id: number }>(
        `SELECT id FROM proposals
         WHERE state = 'pending' AND kind = 'set_status' AND target_item_id = ? AND id <> ?`,
        options.itemId,
        excludeId
      )
    )
  }
  if (kind === 'link_message' && options.itemId && options.messageId) {
    rows.push(
      ...queryAll<{ id: number }>(
        `SELECT id FROM proposals
         WHERE state = 'pending' AND kind = 'link_message' AND target_item_id = ?
           AND id <> ? AND json_extract(payload_json, '$.message_id') = ?`,
        options.itemId,
        excludeId,
        options.messageId
      )
    )
  }
  if (kind === 'add_event' && options.itemId && options.icsUid) {
    rows.push(
      ...queryAll<{ id: number }>(
        `SELECT id FROM proposals
         WHERE state = 'pending' AND kind = 'add_event' AND target_item_id = ?
           AND id <> ? AND json_extract(payload_json, '$.ics_uid') = ?`,
        options.itemId,
        excludeId,
        options.icsUid
      )
    )
  }
  return [...new Set(rows.map((r) => r.id))]
}

/** Rejecting a create_item orphans everything that referenced it. */
export function findPendingByRef(runId: number, ref: string, excludeId: number): number[] {
  return queryAll<{ id: number }>(
    `SELECT id FROM proposals WHERE state = 'pending' AND run_id = ? AND ref = ? AND id <> ?`,
    runId,
    ref,
    excludeId
  ).map((r) => r.id)
}

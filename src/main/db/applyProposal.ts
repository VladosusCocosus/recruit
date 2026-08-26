/**
 * THE PROPOSAL APPLIER.
 *
 * Agent runs never mutate live tables — every write lands in `proposals`. Accepting one
 * here is the only path from a proposal to real data, and it is the only place that
 * resolves the agent's client-side "new:N" refs to real row ids.
 *
 * Guarantees:
 *  - One outer transaction per batch; each proposal additionally runs in its own SAVEPOINT,
 *    so a single bad proposal fails alone instead of poisoning the batch.
 *  - A create_item accepted in the same batch (or in an earlier one, via
 *    proposals.target_item_id) resolves the ref for every sibling proposal.
 *  - Accepting set_status also writes a status_change timeline event.
 *  - Accepting add_event whose ics_uid already exists on the item supersedes the old
 *    event instead of duplicating it.
 */
import type {
  AddEventProposalPayload,
  CreateItemProposalPayload,
  ItemPatch,
  LinkMessageProposalPayload,
  Proposal,
  ProposalDecisionResult,
  ProposalKind,
  SetStatusProposalPayload,
  TimelineEvent,
  TimelineEventInput,
  TimelineEventSource,
  UpdateItemProposalPayload
} from '@shared/types'
import { transact } from './connection'
import {
  createItem,
  linkMessage,
  setItemStatusWithEvent,
  updateItem
} from './repos/items'
import {
  decideProposal,
  findConflictingPending,
  findItemIdForRef,
  findPendingByRef,
  getProposal,
  setProposalTarget,
  supersedeProposals
} from './repos/proposals'
import { addEvent, findLiveEventsByIcsUid, supersedeEvent } from './repos/timeline'

export interface ApplyOptions {
  /** Stamped on timeline events the applier writes. Proposals come from the agent. */
  source?: TimelineEventSource
}

const KIND_ORDER: Record<ProposalKind, number> = {
  create_item: 0,
  update_item: 1,
  set_status: 2,
  link_message: 3,
  add_event: 4
}

function emptyResult(proposalId: number, error: string): ProposalDecisionResult {
  return {
    proposalId,
    state: 'pending',
    createdItemId: null,
    createdEventId: null,
    supersededProposalIds: [],
    error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* ── ref resolution ─────────────────────────────────────────────────────── */

function refKey(runId: number, ref: string): string {
  return `${runId}:${ref}`
}

/**
 * item_id wins, then the proposal's own resolved target, then the ref — first from this
 * batch's map, then from a create_item accepted in an earlier pass.
 */
function resolveItemId(
  proposal: Proposal,
  payloadItemId: number | null | undefined,
  payloadRef: string | null | undefined,
  refs: Map<string, number>
): number {
  if (typeof payloadItemId === 'number') return payloadItemId
  if (typeof proposal.targetItemId === 'number') return proposal.targetItemId

  const ref = payloadRef ?? proposal.ref
  if (ref) {
    const key = refKey(proposal.runId, ref)
    const cached = refs.get(key)
    if (cached !== undefined) return cached
    const stored = findItemIdForRef(proposal.runId, ref)
    if (stored !== null) {
      refs.set(key, stored)
      return stored
    }
    throw new Error(`Unresolved ref "${ref}" — accept its create_item proposal first`)
  }
  throw new Error('Proposal has no target item')
}

/* ── per-kind appliers ──────────────────────────────────────────────────── */

function applyCreateItem(
  proposal: Proposal,
  refs: Map<string, number>
): { itemId: number; conflicts: number[] } {
  const payload = proposal.payload as CreateItemProposalPayload
  const item = createItem({
    company: payload.company,
    companyDomain: payload.company_domain ?? null,
    role: payload.role ?? null,
    location: payload.location ?? null,
    workMode: payload.work_mode ?? null,
    source: payload.source ?? null,
    jobUrl: payload.job_url ?? null,
    statusKey: payload.status_key ?? 'saved',
    descriptionMd: payload.description_md ?? null,
    // "written by Claude · edit to take ownership" — ownership flips on the first user edit.
    descriptionSource: 'agent',
    contactName: payload.contact_name ?? null,
    contactEmail: payload.contact_email ?? null
  })

  for (const ref of [payload.ref, proposal.ref]) {
    if (ref) refs.set(refKey(proposal.runId, ref), item.id)
  }
  setProposalTarget(proposal.id, { targetItemId: item.id })

  const conflicts = findConflictingPending({
    excludeId: proposal.id,
    kind: 'create_item',
    runId: proposal.runId,
    ref: payload.ref ?? proposal.ref
  })
  return { itemId: item.id, conflicts }
}

function applyUpdateItem(proposal: Proposal, refs: Map<string, number>): number {
  const payload = proposal.payload as UpdateItemProposalPayload
  const itemId = resolveItemId(proposal, payload.item_id, null, refs)
  const fields = payload.fields ?? {}

  const patch: ItemPatch = {}
  if (fields.company !== undefined) patch.company = fields.company
  if (fields.company_domain !== undefined) patch.companyDomain = fields.company_domain
  if (fields.role !== undefined) patch.role = fields.role
  if (fields.location !== undefined) patch.location = fields.location
  if (fields.work_mode !== undefined) patch.workMode = fields.work_mode
  if (fields.source !== undefined) patch.source = fields.source
  if (fields.job_url !== undefined) patch.jobUrl = fields.job_url
  if (fields.compensation_note !== undefined) patch.compensationNote = fields.compensation_note
  if (fields.contact_name !== undefined) patch.contactName = fields.contact_name
  if (fields.contact_email !== undefined) patch.contactEmail = fields.contact_email
  if (fields.description_md !== undefined) {
    patch.descriptionMd = fields.description_md
    patch.descriptionSource = 'agent'
  }

  updateItem(itemId, patch)
  setProposalTarget(proposal.id, { targetItemId: itemId })
  return itemId
}

function applySetStatus(
  proposal: Proposal,
  refs: Map<string, number>,
  source: TimelineEventSource
): { itemId: number; event: TimelineEvent | null; conflicts: number[] } {
  const payload = proposal.payload as SetStatusProposalPayload
  const itemId = resolveItemId(proposal, payload.item_id, payload.ref, refs)
  const { event } = setItemStatusWithEvent(itemId, payload.status_key, payload.close_reason ?? null, {
    recordEvent: true,
    source
  })
  setProposalTarget(proposal.id, { targetItemId: itemId, targetEventId: event?.id ?? null })

  const conflicts = findConflictingPending({
    excludeId: proposal.id,
    kind: 'set_status',
    runId: proposal.runId,
    itemId
  })
  return { itemId, event, conflicts }
}

function applyAddEvent(
  proposal: Proposal,
  refs: Map<string, number>,
  source: TimelineEventSource
): { itemId: number; event: TimelineEvent; conflicts: number[] } {
  const payload = proposal.payload as AddEventProposalPayload
  const itemId = resolveItemId(proposal, payload.item_id, payload.ref, refs)

  const input: TimelineEventInput = {
    itemId,
    kind: payload.kind,
    title: payload.title,
    bodyMd: payload.body_md ?? null,
    occurredAt: payload.occurred_at ?? null,
    startsAt: payload.starts_at ?? null,
    endsAt: payload.ends_at ?? null,
    tz: payload.tz ?? null,
    location: payload.location ?? null,
    meetingUrl: payload.meeting_url ?? null,
    messageId: payload.message_id ?? null,
    icsUid: payload.ics_uid ?? null,
    icsSequence: payload.ics_sequence ?? null,
    source: payload.source ?? source
  }

  // Same .ics UID on the same item => this is a reschedule, not a second meeting.
  const prior = payload.ics_uid ? findLiveEventsByIcsUid(itemId, payload.ics_uid) : []
  const event = addEvent(input)
  const incomingSeq = payload.ics_sequence ?? null

  for (const old of prior) {
    const stale =
      incomingSeq !== null && old.icsSequence !== null && incomingSeq < old.icsSequence
    if (stale) {
      // The invite we just accepted is older than what is already on the item.
      supersedeEvent(event.id, old.id)
    } else {
      supersedeEvent(old.id, event.id)
    }
  }

  setProposalTarget(proposal.id, { targetItemId: itemId, targetEventId: event.id })

  const conflicts = findConflictingPending({
    excludeId: proposal.id,
    kind: 'add_event',
    runId: proposal.runId,
    itemId,
    icsUid: payload.ics_uid ?? null
  })
  return { itemId, event, conflicts }
}

function applyLinkMessage(
  proposal: Proposal,
  refs: Map<string, number>
): { itemId: number; conflicts: number[] } {
  const payload = proposal.payload as LinkMessageProposalPayload
  const itemId = resolveItemId(proposal, payload.item_id, payload.ref, refs)
  if (typeof payload.message_id !== 'number') {
    throw new Error('link_message proposal is missing message_id')
  }
  linkMessage(itemId, payload.message_id)
  setProposalTarget(proposal.id, { targetItemId: itemId })

  const conflicts = findConflictingPending({
    excludeId: proposal.id,
    kind: 'link_message',
    runId: proposal.runId,
    itemId,
    messageId: payload.message_id
  })
  return { itemId, conflicts }
}

/* ── the one accept path ────────────────────────────────────────────────── */

function applyOne(
  proposalId: number,
  refs: Map<string, number>,
  options: ApplyOptions
): ProposalDecisionResult {
  const proposal = getProposal(proposalId)
  if (!proposal) return emptyResult(proposalId, `Proposal ${proposalId} not found`)
  if (proposal.state !== 'pending') {
    return {
      proposalId,
      state: proposal.state,
      createdItemId: proposal.targetItemId,
      createdEventId: proposal.targetEventId,
      supersededProposalIds: [],
      error: `Proposal already ${proposal.state}`
    }
  }

  const source = options.source ?? 'agent'
  let createdItemId: number | null = null
  let createdEventId: number | null = null
  let conflicts: number[] = []

  switch (proposal.kind) {
    case 'create_item': {
      const out = applyCreateItem(proposal, refs)
      createdItemId = out.itemId
      conflicts = out.conflicts
      break
    }
    case 'update_item': {
      applyUpdateItem(proposal, refs)
      break
    }
    case 'set_status': {
      const out = applySetStatus(proposal, refs, source)
      createdEventId = out.event?.id ?? null
      conflicts = out.conflicts
      break
    }
    case 'add_event': {
      const out = applyAddEvent(proposal, refs, source)
      createdEventId = out.event.id
      conflicts = out.conflicts
      break
    }
    case 'link_message': {
      const out = applyLinkMessage(proposal, refs)
      conflicts = out.conflicts
      break
    }
    default: {
      const kind = (proposal as Proposal).kind
      throw new Error(`Unknown proposal kind "${kind}"`)
    }
  }

  decideProposal(proposalId, 'accepted')
  return {
    proposalId,
    state: 'accepted',
    createdItemId,
    createdEventId,
    supersededProposalIds: supersedeProposals(conflicts),
    error: null
  }
}

function rejectOne(proposalId: number): ProposalDecisionResult {
  const proposal = getProposal(proposalId)
  if (!proposal) return emptyResult(proposalId, `Proposal ${proposalId} not found`)
  if (proposal.state !== 'pending') {
    return {
      proposalId,
      state: proposal.state,
      createdItemId: proposal.targetItemId,
      createdEventId: proposal.targetEventId,
      supersededProposalIds: [],
      error: `Proposal already ${proposal.state}`
    }
  }

  decideProposal(proposalId, 'rejected')

  // Nothing can reference a create_item that was turned down.
  const orphaned =
    proposal.kind === 'create_item' && proposal.ref
      ? findPendingByRef(proposal.runId, proposal.ref, proposalId)
      : []

  return {
    proposalId,
    state: 'rejected',
    createdItemId: null,
    createdEventId: null,
    supersededProposalIds: supersedeProposals(orphaned),
    error: null
  }
}

/* ── public API ─────────────────────────────────────────────────────────── */

/**
 * Accepts a batch. create_item proposals go first so their refs are resolvable by the
 * siblings that depend on them; results come back in the order the caller asked for.
 */
export function acceptProposals(
  proposalIds: number[],
  options: ApplyOptions = {}
): ProposalDecisionResult[] {
  if (!proposalIds.length) return []
  const refs = new Map<string, number>()
  const results = new Map<number, ProposalDecisionResult>()

  const ordered = [...new Set(proposalIds)]
    .map((id) => ({ id, proposal: getProposal(id) }))
    .sort((a, b) => {
      const ak = a.proposal ? KIND_ORDER[a.proposal.kind] : 99
      const bk = b.proposal ? KIND_ORDER[b.proposal.kind] : 99
      return ak - bk || a.id - b.id
    })

  transact(() => {
    for (const { id } of ordered) {
      try {
        // Own SAVEPOINT: one unresolvable proposal must not roll back the rest.
        results.set(id, transact(() => applyOne(id, refs, options)))
      } catch (error) {
        results.set(id, emptyResult(id, errorMessage(error)))
      }
    }
  })

  return proposalIds.map((id) => results.get(id) ?? emptyResult(id, 'Not processed'))
}

export function acceptProposal(
  proposalId: number,
  options: ApplyOptions = {}
): ProposalDecisionResult {
  return (
    acceptProposals([proposalId], options)[0] ?? emptyResult(proposalId, 'Not processed')
  )
}

export function rejectProposals(proposalIds: number[]): ProposalDecisionResult[] {
  if (!proposalIds.length) return []
  const results = new Map<number, ProposalDecisionResult>()
  transact(() => {
    for (const id of new Set(proposalIds)) {
      try {
        results.set(id, transact(() => rejectOne(id)))
      } catch (error) {
        results.set(id, emptyResult(id, errorMessage(error)))
      }
    }
  })
  return proposalIds.map((id) => results.get(id) ?? emptyResult(id, 'Not processed'))
}

export function rejectProposal(proposalId: number): ProposalDecisionResult {
  return rejectProposals([proposalId])[0] ?? emptyResult(proposalId, 'Not processed')
}

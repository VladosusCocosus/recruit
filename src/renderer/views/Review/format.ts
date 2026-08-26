/**
 * Turning proposals into something a human can judge in two seconds.
 *
 * Pure and display-only. The applier in main is the authority on what a proposal actually
 * does; this file only has to describe it honestly. Generic formatting (dates, costs,
 * weights, reason codes) lives in @renderer/components/format — only the proposal-shaped
 * logic is here.
 */
import { formatDateTime, formatTime, isAllDay } from '@renderer/components'
import type {
  AgentRunSummary,
  CreateItemProposalPayload,
  Item,
  ItemFieldPatch,
  MessageSummary,
  Proposal,
  ProposalCard,
  ProposalKind,
  Status
} from '@shared/types'

/* ── event ranges ──────────────────────────────────────────────────────────
 * The shared formatters handle single stamps; a proposed meeting is a range, and an
 * all-day range has to be read in UTC or it slides a day for anyone west of Greenwich.
 * ────────────────────────────────────────────────────────────────────────── */

const allDayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t) : null
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** "Thu, 28 Aug, 14:00–15:00", or "Thu, 10 Sep · all day". */
export function formatWhen(
  startsAt: string | null | undefined,
  endsAt?: string | null,
  tz?: string | null
): string | null {
  const start = parse(startsAt)
  if (!start) return null

  if (isAllDay(startsAt ?? null, endsAt ?? null, tz ?? null)) {
    return `${allDayFmt.format(start)} · all day`
  }

  const head = formatDateTime(startsAt)
  const end = parse(endsAt)
  if (!end || end.getTime() <= start.getTime()) return head
  return sameLocalDay(start, end) ? `${head}–${formatTime(endsAt)}` : `${head} → ${formatDateTime(endsAt)}`
}

/* ── proposal descriptions ─────────────────────────────────────────────────── */

export type DiffTone = 'add' | 'change' | 'remove' | 'neutral'

export interface DiffLine {
  label: string
  /** Present only when we know the prior value — renders as "before → after". */
  from?: string | null
  to: string | null
  tone: DiffTone
}

export interface ProposalDescription {
  kind: ProposalKind
  /** Short verb for the card chrome, e.g. "Create item". */
  verb: string
  /** The one-line human diff, e.g. "Set Acme Robotics to Screening". */
  headline: string
  lines: DiffLine[]
}

export interface DescribeContext {
  /** Resolved existing target item, when the proposal points at a real row. */
  item: Item | null
  statuses: Map<string, Status>
  /** The create_item payload this proposal's `ref` belongs to, if any. */
  refCreate: CreateItemProposalPayload | null
  messages: Map<number, MessageSummary>
}

const FIELD_LABEL: Record<keyof ItemFieldPatch, string> = {
  company: 'Company',
  company_domain: 'Domain',
  role: 'Role',
  location: 'Location',
  work_mode: 'Work mode',
  source: 'Source',
  job_url: 'Job URL',
  compensation_note: 'Compensation',
  description_md: 'Description',
  contact_name: 'Contact',
  contact_email: 'Contact email'
}

/** Item field backing each snake_case patch key, so we can show "before → after". */
const FIELD_ON_ITEM: Record<keyof ItemFieldPatch, keyof Item> = {
  company: 'company',
  company_domain: 'companyDomain',
  role: 'role',
  location: 'location',
  work_mode: 'workMode',
  source: 'source',
  job_url: 'jobUrl',
  compensation_note: 'compensationNote',
  description_md: 'descriptionMd',
  contact_name: 'contactName',
  contact_email: 'contactEmail'
}

const EVENT_VERB: Record<string, string> = {
  meeting: 'Add meeting',
  note: 'Add note',
  task: 'Add task',
  email: 'Log email',
  status_change: 'Add status change'
}

export function statusLabel(key: string, statuses: Map<string, Status>): string {
  const found = statuses.get(key)
  if (found) return found.label
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** What we call the thing a proposal targets — a real item, or the new one its ref creates. */
export function targetName(ctx: DescribeContext): { name: string; isNew: boolean } {
  if (ctx.item) {
    return {
      name: ctx.item.role ? `${ctx.item.company} · ${ctx.item.role}` : ctx.item.company,
      isNew: false
    }
  }
  if (ctx.refCreate) {
    const c = ctx.refCreate
    return { name: c.role ? `${c.company} · ${c.role}` : c.company, isNew: true }
  }
  return { name: 'this item', isNew: false }
}

function truncate(value: string, max = 140): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function messageLabel(id: number, messages: Map<number, MessageSummary>): string {
  const m = messages.get(id)
  if (!m) return `message #${id}`
  const subject = m.subject?.trim()
  if (subject) return `“${truncate(subject, 60)}”`
  return m.fromAddr ? `email from ${m.fromAddr}` : `message #${id}`
}

export function describeProposal(proposal: Proposal, ctx: DescribeContext): ProposalDescription {
  switch (proposal.kind) {
    case 'create_item': {
      const p = proposal.payload
      const lines: DiffLine[] = []
      const push = (label: string, to: string | null | undefined): void => {
        if (to != null && to !== '') lines.push({ label, to, tone: 'add' })
      }
      push('Role', p.role)
      push('Domain', p.company_domain)
      push('Location', p.location)
      push('Work mode', p.work_mode)
      push('Source', p.source)
      push('Job URL', p.job_url)
      push('Contact', p.contact_name)
      push('Contact email', p.contact_email)
      if (p.status_key) push('Status', statusLabel(p.status_key, ctx.statuses))
      if (p.description_md) push('Description', truncate(p.description_md, 260))
      return {
        kind: proposal.kind,
        verb: 'Create item',
        headline: p.role ? `Create item — ${p.company} · ${p.role}` : `Create item — ${p.company}`,
        lines
      }
    }

    case 'update_item': {
      const p = proposal.payload
      const target = targetName(ctx)
      const entries = Object.entries(p.fields) as Array<[keyof ItemFieldPatch, unknown]>
      const lines: DiffLine[] = entries
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => {
          const before = ctx.item ? ctx.item[FIELD_ON_ITEM[key]] : null
          const beforeStr = before == null || before === '' ? null : truncate(String(before), 120)
          const afterStr = v == null || v === '' ? null : truncate(String(v), 260)
          return {
            label: FIELD_LABEL[key] ?? key,
            from: beforeStr,
            to: afterStr,
            tone: afterStr == null ? 'remove' : beforeStr == null ? 'add' : 'change'
          }
        })
      const count = lines.length
      return {
        kind: proposal.kind,
        verb: 'Update item',
        headline: `Update ${target.name}${count ? ` — ${count} field${count === 1 ? '' : 's'}` : ''}`,
        lines
      }
    }

    case 'set_status': {
      const p = proposal.payload
      const target = targetName(ctx)
      const to = statusLabel(p.status_key, ctx.statuses)
      const from = ctx.item ? statusLabel(ctx.item.statusKey, ctx.statuses) : null
      const lines: DiffLine[] = [{ label: 'Status', from, to, tone: from ? 'change' : 'add' }]
      if (p.close_reason) lines.push({ label: 'Close reason', to: p.close_reason, tone: 'neutral' })
      return {
        kind: proposal.kind,
        verb: 'Set status',
        headline: `Set ${target.name} to ${to}`,
        lines
      }
    }

    case 'add_event': {
      const p = proposal.payload
      const target = targetName(ctx)
      const when = formatWhen(p.starts_at, p.ends_at, p.tz) ?? (p.occurred_at ? formatDateTime(p.occurred_at) : null)
      const verb = EVENT_VERB[p.kind] ?? 'Add event'
      const lines: DiffLine[] = []
      if (when) lines.push({ label: 'When', to: when, tone: 'add' })
      if (p.location) lines.push({ label: 'Location', to: p.location, tone: 'add' })
      if (p.meeting_url) lines.push({ label: 'Meeting', to: p.meeting_url, tone: 'add' })
      if (p.body_md) lines.push({ label: 'Notes', to: truncate(p.body_md, 260), tone: 'add' })
      lines.push({ label: 'On', to: target.name, tone: 'neutral' })
      return {
        kind: proposal.kind,
        verb,
        headline: when ? `${verb} — ${p.title} · ${when}` : `${verb} — ${p.title}`,
        lines
      }
    }

    case 'link_message': {
      const p = proposal.payload
      const target = targetName(ctx)
      return {
        kind: proposal.kind,
        verb: 'Link email',
        headline: `Link ${messageLabel(p.message_id, ctx.messages)} to ${target.name}`,
        lines: [{ label: 'On', to: target.name, tone: 'neutral' }]
      }
    }
  }
}

/* ── grouping ──────────────────────────────────────────────────────────────── */

/**
 * One accept/reject unit in the queue.
 *
 * Proposals that share a `ref` ("new:1") describe one intent — create the item, set its
 * status, add its first meeting — and the applier resolves the ref at accept time. Splitting
 * them would let a user accept an event whose item was never created, so they travel together.
 */
export interface ProposalGroup {
  key: string
  runId: number
  run: AgentRunSummary
  ref: string | null
  /** Pending cards in this group, in proposal order. */
  cards: ProposalCard[]
  /** Every pending proposal id to decide together — includes siblings outside the page. */
  proposalIds: number[]
  /** The create_item payload, when this group brings a new item into existence. */
  creation: CreateItemProposalPayload | null
  /** Resolved existing target, when the group acts on a row that already exists. */
  item: Item | null
  /** Deduped union of the source messages behind the group. */
  messages: MessageSummary[]
  /** Weakest link across the group — a bundle is only as trustworthy as its worst part. */
  confidence: number | null
  /** True when siblings share a ref, i.e. this card is a bundle. */
  isBundle: boolean
  sortKey: number
}

export interface RunGroup {
  runId: number
  run: AgentRunSummary
  groups: ProposalGroup[]
  proposalIds: number[]
}

function groupKey(card: ProposalCard): string {
  const p = card.proposal
  return p.ref ? `${p.runId}::ref::${p.ref}` : `${p.runId}::solo::${p.id}`
}

/** Group pending cards into decide-together units, then bucket those by run. */
export function buildRunGroups(cards: ProposalCard[]): RunGroup[] {
  const byKey = new Map<string, ProposalCard[]>()
  const order: string[] = []
  for (const card of cards) {
    const key = groupKey(card)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(card)
    else {
      byKey.set(key, [card])
      order.push(key)
    }
  }

  const groups: ProposalGroup[] = order.map((key) => {
    const bucket = byKey.get(key) ?? []
    const first = bucket[0]
    const sorted = [...bucket].sort((a, b) => a.proposal.id - b.proposal.id)

    const ids = new Set<number>(sorted.map((c) => c.proposal.id))
    // A sibling can fall outside this page (limit, or listed elsewhere). `related` is the
    // run's own view of the ref, so trust it for anything still pending.
    for (const card of sorted) {
      for (const sib of card.related) {
        if (sib.state === 'pending') ids.add(sib.id)
      }
    }

    let creation: CreateItemProposalPayload | null = null
    for (const card of sorted) {
      if (card.proposal.kind === 'create_item') creation = card.proposal.payload
    }
    if (!creation) {
      for (const card of sorted) {
        for (const sib of card.related) {
          if (sib.kind === 'create_item') creation = sib.payload
        }
      }
    }

    const messages: MessageSummary[] = []
    const seenMessages = new Set<number>()
    for (const card of sorted) {
      for (const m of card.messages) {
        if (seenMessages.has(m.id)) continue
        seenMessages.add(m.id)
        messages.push(m)
      }
    }

    const confidences = sorted
      .map((c) => c.proposal.confidence)
      .filter((c): c is number => typeof c === 'number')

    const item = sorted.find((c) => c.item)?.item ?? null

    return {
      key,
      runId: first.proposal.runId,
      run: first.run,
      ref: first.proposal.ref,
      cards: sorted,
      proposalIds: [...ids],
      creation,
      item,
      messages,
      confidence: confidences.length ? Math.min(...confidences) : null,
      isBundle: ids.size > 1,
      sortKey: sorted[0].proposal.id
    }
  })

  const byRun = new Map<number, RunGroup>()
  for (const group of groups) {
    const existing = byRun.get(group.runId)
    if (existing) existing.groups.push(group)
    else
      byRun.set(group.runId, {
        runId: group.runId,
        run: group.run,
        groups: [group],
        proposalIds: []
      })
  }

  const runs = [...byRun.values()]
  for (const run of runs) {
    run.groups.sort((a, b) => a.sortKey - b.sortKey)
    const ids = new Set<number>()
    for (const g of run.groups) for (const id of g.proposalIds) ids.add(id)
    run.proposalIds = [...ids]
  }
  runs.sort((a, b) => (a.run.startedAt < b.run.startedAt ? 1 : -1))
  return runs
}

/** Glyph for each proposal kind, from the shared icon set. */
export const PROPOSAL_ICON = {
  create_item: 'plus',
  update_item: 'refresh',
  set_status: 'board',
  add_event: 'calendar',
  link_message: 'link'
} as const

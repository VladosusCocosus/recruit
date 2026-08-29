import type { AgentEnvelope, AgentRun, AgentRunKind, AgentRunSummary } from '@shared/types'
import { count, execute, placeholders, queryAll, queryOne, transact } from '../connection'
import {
  nowIso,
  rowToAgentRun,
  rowToAgentRunSummary,
  toInt,
  toJson,
  type AgentRunRow
} from '../rows'

export interface CreateRunInput {
  kind: AgentRunKind
  /** The argv actually spawned. Stored verbatim in command_json. */
  command?: string[] | null
  model?: string | null
  startedAt?: string
}

export interface FinishRunPatch {
  finishedAt?: string
  sessionId?: string | null
  exitCode?: number | null
  isError?: boolean
  errorText?: string | null
  durationMs?: number | null
  costUsd?: number | null
  /** The whole `claude -p --output-format json` envelope. */
  envelope?: AgentEnvelope | null
}

const SELECT = `
  SELECT r.*,
    (SELECT group_concat(arm.message_id) FROM agent_run_messages arm WHERE arm.run_id = r.id)
      AS message_ids,
    (SELECT count(*) FROM proposals p WHERE p.run_id = r.id) AS proposal_count
  FROM agent_runs r`

/* ── reads ──────────────────────────────────────────────────────────────── */

export function getRun(runId: number): AgentRun | null {
  const row = queryOne<AgentRunRow>(`${SELECT} WHERE r.id = ?`, runId)
  return row ? rowToAgentRun(row) : null
}

export function getRunSummary(runId: number): AgentRunSummary | null {
  const row = queryOne<AgentRunRow>(`${SELECT} WHERE r.id = ?`, runId)
  return row ? rowToAgentRunSummary(row) : null
}

export function listRuns(limit = 50): AgentRunSummary[] {
  return queryAll<AgentRunRow>(`${SELECT} ORDER BY r.id DESC LIMIT ?`, limit).map(
    rowToAgentRunSummary
  )
}

export function getLatestRun(kind?: AgentRunKind): AgentRun | null {
  const row = kind
    ? queryOne<AgentRunRow>(`${SELECT} WHERE r.kind = ? ORDER BY r.id DESC LIMIT 1`, kind)
    : queryOne<AgentRunRow>(`${SELECT} ORDER BY r.id DESC LIMIT 1`)
  return row ? rowToAgentRun(row) : null
}

export function countRuns(kind?: AgentRunKind): number {
  return kind === undefined
    ? count('SELECT count(*) FROM agent_runs')
    : count('SELECT count(*) FROM agent_runs WHERE kind = ?', kind)
}

/* ── writes ─────────────────────────────────────────────────────────────── */

export function createRun(input: CreateRunInput): AgentRun {
  const info = execute(
    `INSERT INTO agent_runs (kind, started_at, command_json, model, is_error)
     VALUES (?, ?, ?, ?, 0)`,
    input.kind,
    input.startedAt ?? nowIso(),
    toJson(input.command ?? null),
    input.model ?? null
  )
  return getRun(Number(info.lastInsertRowid)) as AgentRun
}

/** The session id arrives on the first stream event, before the run finishes. */
export function updateRunSession(runId: number, sessionId: string | null): void {
  execute('UPDATE agent_runs SET session_id = ? WHERE id = ?', sessionId, runId)
}

export function finishRun(runId: number, patch: FinishRunPatch = {}): AgentRun {
  const sets: string[] = ['finished_at = ?']
  const params: unknown[] = [patch.finishedAt ?? nowIso()]
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.sessionId !== undefined) put('session_id', patch.sessionId)
  if (patch.exitCode !== undefined) put('exit_code', patch.exitCode)
  if (patch.isError !== undefined) put('is_error', toInt(patch.isError) ?? 0)
  if (patch.errorText !== undefined) put('error_text', patch.errorText)
  if (patch.durationMs !== undefined) put('duration_ms', patch.durationMs)
  if (patch.costUsd !== undefined) put('cost_usd', patch.costUsd)
  if (patch.envelope !== undefined) put('raw_envelope_json', toJson(patch.envelope))

  params.push(runId)
  execute(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`, ...params)

  const run = getRun(runId)
  if (!run) throw new Error(`Agent run ${runId} not found`)
  return run
}

/**
 * Finish a run straight from the CLI envelope. Envelope fields stay snake_case on the
 * wire; errorKind (including the not_signed_in state) is derived on read.
 */
export function finishRunFromEnvelope(
  runId: number,
  envelope: AgentEnvelope,
  extra: Pick<FinishRunPatch, 'exitCode' | 'errorText' | 'finishedAt'> = {}
): AgentRun {
  return finishRun(runId, {
    ...extra,
    sessionId: envelope.session_id ?? null,
    isError: Boolean(envelope.is_error),
    errorText: extra.errorText ?? (envelope.is_error ? envelope.result : null),
    durationMs: envelope.duration_ms ?? null,
    costUsd: envelope.total_cost_usd ?? null,
    envelope
  })
}

/* ── the per-run READ ALLOWLIST ─────────────────────────────────────────── */

/**
 * Replaces the run's allowlist. This is the security boundary for the triage run:
 * get_message MUST reject any id that is not in here.
 */
export function setRunAllowlist(runId: number, messageIds: number[]): void {
  transact(() => {
    execute('DELETE FROM agent_run_messages WHERE run_id = ?', runId)
    for (const messageId of new Set(messageIds)) {
      execute(
        'INSERT OR IGNORE INTO agent_run_messages (run_id, message_id) VALUES (?, ?)',
        runId,
        messageId
      )
    }
  })
}

export function addRunMessages(runId: number, messageIds: number[]): void {
  if (!messageIds.length) return
  transact(() => {
    for (const messageId of new Set(messageIds)) {
      execute(
        'INSERT OR IGNORE INTO agent_run_messages (run_id, message_id) VALUES (?, ?)',
        runId,
        messageId
      )
    }
  })
}

export function listRunMessageIds(runId: number): number[] {
  return queryAll<{ message_id: number }>(
    'SELECT message_id FROM agent_run_messages WHERE run_id = ? ORDER BY message_id',
    runId
  ).map((r) => r.message_id)
}

/**
 * Gate for every run-scoped MCP read tool.
 *
 * The allowlist is written before the child is spawned, so a message the user deletes while the
 * run is in flight is still in it. Joining `messages` closes the gate on it there and then —
 * which also stops propose_link_message naming a message the app no longer shows.
 */
export function isMessageAllowed(runId: number, messageId: number): boolean {
  return (
    count(
      `SELECT count(*) FROM agent_run_messages arm
       JOIN messages m ON m.id = arm.message_id
       WHERE arm.run_id = ? AND arm.message_id = ? AND m.deleted_at IS NULL`,
      runId,
      messageId
    ) > 0
  )
}

/** Bulk variant — filters a caller-supplied id list down to what the run may read. */
export function filterAllowedMessages(runId: number, messageIds: number[]): number[] {
  if (!messageIds.length) return []
  return queryAll<{ message_id: number }>(
    `SELECT arm.message_id FROM agent_run_messages arm
     JOIN messages m ON m.id = arm.message_id
     WHERE arm.run_id = ? AND arm.message_id IN (${placeholders(messageIds.length)})
       AND m.deleted_at IS NULL`,
    runId,
    ...messageIds
  ).map((r) => r.message_id)
}

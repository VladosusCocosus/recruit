/**
 * The narrow seam between the agent bridge and the rest of main.
 *
 * src/main/agent/** imports NOTHING from src/main/db — it only ever sees `AgentRepo`.
 * The db agent implements this interface; everything here is expressed in shared domain
 * types so neither side has to know the other's internals.
 *
 * Every method may be sync (better-sqlite3) or async — the bridge awaits all of them.
 */
import type {
  AgentEngine,
  AgentEnvelope,
  AgentRunKind,
  AgentRunUpdate,
  ItemDetail,
  ItemQuery,
  ItemSummary,
  Message,
  MessageSummary,
  ProposalKind,
  ProposalPayloadMap
} from '@shared/types'

export type Awaitable<T> = T | Promise<T>

/* ────────────────────────────────────────────────────────────────────────────
 * proposals — the ONLY write the agent can reach
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One row for `proposals`. `payload` is stored verbatim as payload_json (snake_case wire
 * shape). state is always 'pending' at insert time — the bridge cannot create any other
 * state, and it has no path to items/timeline_events/item_messages at all.
 */
export interface InsertProposalInput<K extends ProposalKind = ProposalKind> {
  runId: number
  kind: K
  /** Client-side id from the agent ("new:1"), or null when it targets a real row. */
  ref: string | null
  targetItemId: number | null
  targetEventId: number | null
  payload: ProposalPayloadMap[K]
  confidence: number | null
  rationale: string | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * agent_runs lifecycle
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CreateRunInput {
  kind: AgentRunKind
  model: string
}

export interface CreatedRun {
  id: number
  /** ISO-8601 UTC. */
  startedAt: string
}

export interface FinishRunPatch {
  finishedAt: string
  exitCode: number | null
  isError: boolean
  errorText: string | null
  sessionId: string | null
  durationMs: number | null
  costUsd: number | null
  rawEnvelope: AgentEnvelope | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * the repo
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AgentRepo {
  // ── per-run READ ALLOWLIST (agent_run_messages) ───────────────────────────
  /** MUST be enforced by get_message. False for anything outside this run. */
  isMessageAllowed(runId: number, messageId: number): Awaitable<boolean>
  /** Exactly the messages in this run's allowlist. Backs list_messages. */
  listRunMessages(runId: number): Awaitable<MessageSummary[]>
  /** Full body/headers/attachments. The bridge checks isMessageAllowed FIRST. */
  getMessage(messageId: number): Awaitable<Message | null>

  // ── tracker reads ─────────────────────────────────────────────────────────
  listItems(query?: ItemQuery): Awaitable<ItemSummary[]>
  getItem(itemId: number): Awaitable<ItemDetail | null>
  /** Match on company / company_domain / role. */
  searchItems(query: string): Awaitable<ItemSummary[]>

  // ── the only write ────────────────────────────────────────────────────────
  insertProposal(input: InsertProposalInput): Awaitable<{ id: number }>
  countRunProposals(runId: number): Awaitable<number>

  // ── run rows ──────────────────────────────────────────────────────────────
  createRun(input: CreateRunInput): Awaitable<CreatedRun>
  /**
   * Persists the argv actually spawned -> command_json. Separate from createRun because
   * argv embeds the run-scoped bearer token, which cannot exist before the run row does.
   */
  setRunCommand(runId: number, command: string[]): Awaitable<void>
  /** Writes agent_run_messages — the read allowlist. Called BEFORE the child is spawned. */
  attachRunMessages(runId: number, messageIds: number[]): Awaitable<void>
  finishRun(runId: number, patch: FinishRunPatch): Awaitable<void>
}

/* ────────────────────────────────────────────────────────────────────────────
 * events
 * ──────────────────────────────────────────────────────────────────────────── */

/** Emitted on EVERY MCP tool call. Drives the toolbar's live ticker. */
export interface AgentToolCallEvent {
  runId: number
  /** Bare tool name, e.g. "list_messages" (no mcp__tracker__ prefix). */
  tool: string
  phase: 'start' | 'ok' | 'error'
  /** Short human string for the ticker, e.g. "message 41" or "Acme". */
  detail: string | null
  /** Set on phase 'ok' for a propose_* call. */
  proposalId?: number
  /** Set for get_message, so progress can count DISTINCT messages read. */
  messageId?: number
  error?: string
  at: string
}

export interface AgentDeps {
  repo: AgentRepo
  /** Fired on every tool call, both phases. */
  onToolCall?: (event: AgentToolCallEvent) => void
  /** Fired on every run state change. Forward straight to broadcast('runUpdate', u). */
  onRunUpdate?: (update: AgentRunUpdate) => void
  /** Which CLI to spawn. Default 'claude'. */
  engine?: AgentEngine
  /** Path to the SELECTED engine's binary. Omit to let the runner search PATH. */
  agentBin?: string
  /** cwd for the child process. Default os.tmpdir() — never the user's repo. */
  cwd?: string
  /** Hard wall-clock cap per run. Default 5 minutes. */
  timeoutMs?: number
  /** Default model when StartRunInput.model is absent. Default 'sonnet'. */
  model?: string
  /** enrich runs (WebSearch) are OFF unless the setting is on. Default false. */
  enrichmentEnabled?: boolean
}

/**
 * The SINGLE classifier for a failed agent run.
 *
 * A run gets classified twice in its life: once live by the runner, from the child's
 * streams, and again every time the DB row is read back. Those used to be two separate
 * implementations, and they disagreed on the case that matters most — an auth failure
 * with no parseable envelope was `not_signed_in` live and `unknown` on re-read, which
 * downgraded the dedicated sign-in banner to a generic "The run failed" the moment the
 * UI refreshed. Both callers now come here. Do not add a second copy of these patterns.
 */
import {
  CLAUDE_AUTH_ERROR_MARKER,
  CLAUDE_NOT_SIGNED_IN_MESSAGE,
  CODEX_NOT_SIGNED_IN_MESSAGE,
  type AgentErrorKind
} from './types'

/**
 * Anything that means "the CLI has no usable credentials". Includes the exact messages the
 * runner itself stores, because on re-read that string may be all that survives.
 *
 * The last three are Codex's shape of the same condition: it reports a signed-out session
 * as a 401 from the OpenAI endpoint rather than as prose. The host is part of the pattern
 * on purpose — the tracker's own MCP listener answers 401 for a stale run token, and that
 * is a bug in this app, not a reason to tell the user to log in again.
 */
const AUTH_PATTERNS: RegExp[] = [
  new RegExp(escapeLiteral(CLAUDE_AUTH_ERROR_MARKER), 'i'),
  new RegExp(escapeLiteral(CLAUDE_NOT_SIGNED_IN_MESSAGE), 'i'),
  new RegExp(escapeLiteral(CODEX_NOT_SIGNED_IN_MESSAGE), 'i'),
  /invalid api key/i,
  /authentication_error/i,
  /not logged in/i,
  /isn['’]t signed in/i,
  /please run\s+.{0,3}(?:\/login|claude|codex)/i,
  /oauth token (?:has )?expired/i,
  /credentials? (?:not found|missing|expired)/i,
  /credit balance is too low/i,
  /missing bearer or basic authentication/i,
  /401 unauthorized[^\n]*\bopenai\.com/i,
  /run `codex` (?:login|in a terminal)/i
]

const CLI_MISSING = /enoent|command not found|not found on path|is not recognized|(?:claude|codex):? (?:cli )?(?:was )?not found|no such file or directory/i
const STOPPED = /\bstopped\b|aborted|sigterm|sigkill|cancell?ed/i
const TIMEOUT = /timed?[ -]?out|timeout/i
const SPAWN_FAILED = /spawn|failed to start|eacces|eperm/i
const BAD_OUTPUT = /could not parse|no json|unexpected token|invalid json|malformed json|parse error/i

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function looksLikeAuthFailure(text: string): boolean {
  if (!text) return false
  return AUTH_PATTERNS.some((re) => re.test(text))
}

export interface AgentErrorFacts {
  /** agent_runs.error_text, or the live result message. */
  errorText: string | null
  /** envelope.result, or null when the CLI never produced a parseable envelope. */
  envelopeResult: string | null
  /** Whether the run is recorded as failed at all. */
  isError: boolean
}

/**
 * Returns null for a run that did not fail. Order is deliberate: auth is checked before
 * everything else so a sign-in problem never falls through to a generic bucket.
 */
export function classifyAgentErrorFacts(facts: AgentErrorFacts): AgentErrorKind | null {
  if (!facts.isError && !facts.errorText) return null
  const text = `${facts.errorText ?? ''}\n${facts.envelopeResult ?? ''}`
  if (!text.trim()) return facts.isError ? 'unknown' : null
  if (looksLikeAuthFailure(text)) return 'not_signed_in'
  if (CLI_MISSING.test(text)) return 'cli_missing'
  if (STOPPED.test(text)) return 'stopped'
  if (TIMEOUT.test(text)) return 'timeout'
  if (SPAWN_FAILED.test(text)) return 'spawn_failed'
  if (BAD_OUTPUT.test(text)) return 'bad_output'
  return 'unknown'
}

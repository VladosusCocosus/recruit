/**
 * Spawns the `claude` CLI and turns its stdout envelope into a run row + a typed result.
 *
 * The runner owns the MCP bridge: it starts the listener, mints a per-run bearer token,
 * writes the read allowlist BEFORE the child exists, and revokes the token in a finally
 * block. A run's token is dead the moment the run ends, whether it succeeded, failed,
 * timed out, or was stopped.
 *
 * Two run kinds, deliberately non-overlapping:
 *   triage — tracker MCP tools, --tools "" (no built-ins, so no Bash/Read/Write/WebFetch).
 *   enrich — --tools "WebSearch" and an EMPTY mcp config, so it cannot reach the tracker
 *            at all. Its only input is a company name string; it never sees email.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { classifyAgentErrorFacts, looksLikeAuthFailure } from '@shared/agentErrors'
import {
  CLAUDE_NOT_SIGNED_IN_MESSAGE,
  type AgentEnvelope,
  type AgentErrorKind,
  type AgentRunKind,
  type AgentRunUpdate
} from '@shared/types'
import type { AgentDeps, AgentToolCallEvent } from './deps'
import { createMcpServer, type McpBridge } from './mcpServer'
import {
  ENRICH_SYSTEM_PROMPT,
  enrichTaskPrompt,
  TRIAGE_SYSTEM_PROMPT,
  triageTaskPrompt
} from './prompts'
import { TRACKER_ALLOWED_TOOLS } from './schemas'

/** spawn() with stdio ['ignore','pipe','pipe'] — stdin is null by construction. */
type AgentChild = ChildProcessByStdio<null, Readable, Readable>

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_MODEL = 'sonnet'
const KILL_GRACE_MS = 3000
const TICK_MS = 1000

/* ────────────────────────────────────────────────────────────────────────────
 * results
 * ──────────────────────────────────────────────────────────────────────────── */

export type AgentRunResult =
  | {
      kind: 'ok'
      runId: number
      /** The model's final text reply. */
      result: string
      sessionId: string | null
      costUsd: number | null
      durationMs: number
      proposalCount: number
      envelope: AgentEnvelope
    }
  | {
      /** FIRST-CLASS UI STATE. Show CLAUDE_NOT_SIGNED_IN_MESSAGE, not a generic failure. */
      kind: 'auth'
      runId: number
      message: string
      envelope: AgentEnvelope | null
      raw: string
    }
  | {
      kind: 'error'
      runId: number
      errorKind: AgentErrorKind
      message: string
      exitCode: number | null
      envelope: AgentEnvelope | null
      raw: string
    }

export interface StartedRun {
  runId: number
  kind: AgentRunKind
  startedAt: string
  /** Resolves once the child exits and the run row is finalized. Never rejects. */
  completed: Promise<AgentRunResult>
}

export interface RunOptions {
  /** Overrides AppSettings.model for this run. */
  model?: string
  timeoutMs?: number
}

export interface AgentRunner {
  spawnTriageRun(messageIds: number[], options?: RunOptions): Promise<StartedRun>
  spawnEnrichRun(companyName: string, options?: RunOptions): Promise<StartedRun>
  /** Kills the child. The run finishes as {kind:'error', errorKind:'stopped'}. */
  cancelRun(runId: number): void
  /** Newest in-flight run, for RecruitApi.getActiveRun(). */
  getActiveRun(): AgentRunUpdate | null
  /** Whether the claude CLI can be found at all -> AppInfo.claudeCliAvailable. */
  isClaudeAvailable(): boolean
  /** Revoke every token and close the MCP listener. Call on before-quit. */
  dispose(): Promise<void>
}

/* ────────────────────────────────────────────────────────────────────────────
 * locating the CLI
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A GUI-launched .app does not inherit the login shell's PATH, so `claude` on
 * ~/.local/bin is invisible unless we look for it.
 */
const CLI_CANDIDATES = (): string[] => [
  join(homedir(), '.local', 'bin', 'claude'),
  join(homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  join(homedir(), '.bun', 'bin', 'claude'),
  join(homedir(), '.volta', 'bin', 'claude')
]

const EXTRA_PATH = (): string =>
  [
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].join(':')

/** Absolute path to the CLI, or null if we genuinely cannot find it. */
export function findClaudeBin(): string | null {
  for (const candidate of CLI_CANDIDATES()) {
    if (existsSync(candidate)) return candidate
  }
  const dirs = `${process.env['PATH'] ?? ''}:${EXTRA_PATH()}`.split(':').filter(Boolean)
  for (const dir of dirs) {
    const candidate = join(dir, 'claude')
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function resolveClaudeBin(override?: string): string {
  return override ?? findClaudeBin() ?? 'claude'
}

/** Child env: inherited, PATH widened, and Electron's own hooks stripped. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['NODE_OPTIONS']
  env['PATH'] = `${env['PATH'] ?? ''}:${EXTRA_PATH()}`
  return env
}

/* ────────────────────────────────────────────────────────────────────────────
 * argv
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ORDER MATTERS. The prompt is a POSITIONAL argument and several flags here are
 * variadic (--tools, --mcp-config, --allowedTools). A variadic flag swallows every
 * following non-flag token, so the prompt must come first — immediately after the
 * boolean -p — and every variadic value must be followed by another flag.
 */
export function buildTriageArgv(input: {
  taskPrompt: string
  mcpConfigJson: string
  model: string
}): string[] {
  return [
    '-p',
    input.taskPrompt,
    '--system-prompt',
    TRIAGE_SYSTEM_PROMPT,
    // "" is the documented way to disable the entire built-in tool set:
    // no Bash, no Read, no Write, no WebFetch, no WebSearch.
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    input.mcpConfigJson,
    '--allowedTools',
    ...TRACKER_ALLOWED_TOOLS,
    '--permission-mode',
    'bypassPermissions',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--model',
    input.model
  ]
}

/** Enrich: WebSearch and nothing else. The empty mcp config is the isolation. */
export function buildEnrichArgv(input: { taskPrompt: string; model: string }): string[] {
  return [
    '-p',
    input.taskPrompt,
    '--system-prompt',
    ENRICH_SYSTEM_PROMPT,
    '--tools',
    'WebSearch',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--allowedTools',
    'WebSearch',
    '--permission-mode',
    'bypassPermissions',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--model',
    input.model
  ]
}

/** Never persist a live bearer token. */
export function redactArgv(argv: string[]): string[] {
  return argv.map((a) => a.replace(/"Bearer [^"]+"/g, '"Bearer ***"'))
}

/* ────────────────────────────────────────────────────────────────────────────
 * envelope parsing + error classification
 * ──────────────────────────────────────────────────────────────────────────── */

/** stdout is usually pure JSON, but a stray warning line before it is survivable. */
export function parseEnvelope(stdout: string): AgentEnvelope | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  const attempt = (s: string): AgentEnvelope | null => {
    try {
      const parsed: unknown = JSON.parse(s)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as AgentEnvelope
      }
    } catch {
      /* fall through */
    }
    return null
  }
  const direct = attempt(trimmed)
  if (direct) return direct
  // Re-try from each line that opens an object, newest-first.
  const lines = trimmed.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith('{')) continue
    const candidate = attempt(lines.slice(i).join('\n'))
    if (candidate) return candidate
  }
  return null
}

export { looksLikeAuthFailure }

/**
 * Derives AgentRun.errorKind, which is not a column. The real implementation lives in
 * @shared/agentErrors so that this and the db layer's deriveErrorKind cannot drift —
 * they are the same function applied to the same run at two points in its life.
 */
export function classifyAgentError(
  errorText: string | null,
  envelope: AgentEnvelope | null
): AgentErrorKind | null {
  return classifyAgentErrorFacts({
    errorText,
    envelopeResult: envelope?.result ?? null,
    isError: Boolean(envelope?.is_error)
  })
}

/* ────────────────────────────────────────────────────────────────────────────
 * the runner
 * ──────────────────────────────────────────────────────────────────────────── */

interface ActiveRun {
  update: AgentRunUpdate
  child: AgentChild | null
  timer: NodeJS.Timeout | null
  ticker: NodeJS.Timeout | null
  stopped: boolean
  timedOut: boolean
}

export function createAgentRunner(deps: AgentDeps): AgentRunner {
  const { repo } = deps
  const active = new Map<number, ActiveRun>()

  const bridge: McpBridge = createMcpServer({
    repo,
    onToolCall: (event: AgentToolCallEvent) => {
      applyToolCall(event)
      try {
        deps.onToolCall?.(event)
      } catch {
        /* listeners must not break a tool call */
      }
    }
  })

  function publish(run: ActiveRun): void {
    run.update.elapsedMs = Date.now() - Date.parse(run.update.startedAt)
    try {
      deps.onRunUpdate?.({ ...run.update })
    } catch {
      /* ignore */
    }
  }

  function applyToolCall(event: AgentToolCallEvent): void {
    const run = active.get(event.runId)
    if (!run) return
    if (event.phase === 'start') {
      run.update.toolCalls += 1
      run.update.currentTool = event.tool
    } else if (event.phase === 'ok' && event.proposalId != null) {
      run.update.proposalCount += 1
    }
    publish(run)
  }

  async function begin(
    kind: AgentRunKind,
    messageIds: number[],
    argvFor: (mcpConfigJson: string) => string[],
    needsBridge: boolean,
    options: RunOptions | undefined
  ): Promise<StartedRun> {
    const model = options?.model ?? deps.model ?? DEFAULT_MODEL
    const timeoutMs = options?.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const created = await repo.createRun({ kind, model })
    const runId = created.id

    const run: ActiveRun = {
      update: {
        runId,
        kind,
        state: 'starting',
        startedAt: created.startedAt,
        elapsedMs: 0,
        currentTool: null,
        toolCalls: 0,
        proposalCount: 0,
        errorKind: null,
        errorText: null
      },
      child: null,
      timer: null,
      ticker: null,
      stopped: false,
      timedOut: false
    }
    active.set(runId, run)
    publish(run)

    // The allowlist must exist before the child can call a single tool.
    if (messageIds.length > 0) await repo.attachRunMessages(runId, messageIds)

    let token: string | null = null
    let argv: string[]
    try {
      if (needsBridge) {
        await bridge.start()
        token = bridge.mintToken(runId)
        argv = argvFor(bridge.mcpConfigJson(token))
      } else {
        argv = argvFor('{"mcpServers":{}}')
      }
      await repo.setRunCommand(runId, redactArgv(argv))
    } catch (err) {
      if (token) bridge.revokeToken(token)
      active.delete(runId)
      const message = err instanceof Error ? err.message : String(err)
      const result = await finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: 'spawn_failed',
        message,
        exitCode: null,
        envelope: null,
        raw: ''
      })
      return {
        runId,
        kind,
        startedAt: created.startedAt,
        completed: Promise.resolve(result)
      }
    }

    const completed = execute(runId, run, argv, token, timeoutMs)
    return { runId, kind, startedAt: created.startedAt, completed }
  }

  async function execute(
    runId: number,
    run: ActiveRun,
    argv: string[],
    token: string | null,
    timeoutMs: number
  ): Promise<AgentRunResult> {
    const bin = resolveClaudeBin(deps.claudeBin)
    const startedMs = Date.now()

    const raw = await new Promise<{
      stdout: string
      stderr: string
      code: number | null
      spawnError: Error | null
    }>((resolve) => {
      let child: AgentChild
      try {
        child = spawn(bin, argv, {
          // stdin closed: the CLI warns and can hang if it stays open.
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: deps.cwd ?? tmpdir(),
          env: childEnv(),
          windowsHide: true
        })
      } catch (err) {
        resolve({
          stdout: '',
          stderr: '',
          code: null,
          spawnError: err instanceof Error ? err : new Error(String(err))
        })
        return
      }

      run.child = child
      run.update.state = 'running'
      run.ticker = setInterval(() => publish(run), TICK_MS)
      publish(run)

      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d: string) => {
        stdout += d
      })
      child.stderr.on('data', (d: string) => {
        stderr += d
      })

      run.timer = setTimeout(() => {
        run.timedOut = true
        kill(run)
      }, timeoutMs)

      let settled = false
      const done = (code: number | null, spawnError: Error | null): void => {
        if (settled) return
        settled = true
        if (run.timer) clearTimeout(run.timer)
        if (run.ticker) clearInterval(run.ticker)
        resolve({ stdout, stderr, code, spawnError })
      }

      child.on('error', (err) => done(null, err))
      child.on('close', (code) => done(code, null))
    })

    if (token) bridge.revokeToken(token)
    active.delete(runId)

    const durationMs = Date.now() - startedMs
    const envelope = parseEnvelope(raw.stdout)
    const combined = `${raw.stdout}\n${raw.stderr}`

    // ── spawn-level failures ────────────────────────────────────────────────
    if (raw.spawnError) {
      const isEnoent = (raw.spawnError as NodeJS.ErrnoException).code === 'ENOENT'
      return finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: isEnoent ? 'cli_missing' : 'spawn_failed',
        message: isEnoent
          ? `The claude CLI was not found (looked for "${bin}"). Install Claude Code, or set the CLI path in Settings.`
          : raw.spawnError.message,
        exitCode: null,
        envelope: null,
        raw: combined
      })
    }

    // ── auth: checked BEFORE the generic error path, on purpose ─────────────
    // Only look at envelope.result when the envelope actually failed. On a SUCCESSFUL run
    // that text is the model's own prose, which can quote an email that happens to say
    // "Invalid API key" — matching there would misreport a good run as a sign-in problem.
    // With no envelope at all, fall back to the raw streams.
    const authText = envelope ? (envelope.is_error ? envelope.result : '') : combined
    if (looksLikeAuthFailure(authText)) {
      return finish(runId, run, {
        kind: 'auth',
        runId,
        message: CLAUDE_NOT_SIGNED_IN_MESSAGE,
        envelope,
        raw: combined
      })
    }

    if (run.stopped) {
      return finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: 'stopped',
        message: 'Run stopped.',
        exitCode: raw.code,
        envelope,
        raw: combined
      })
    }

    if (run.timedOut) {
      return finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: 'timeout',
        message: `Run timed out after ${Math.round(timeoutMs / 1000)}s.`,
        exitCode: raw.code,
        envelope,
        raw: combined
      })
    }

    if (!envelope) {
      return finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: 'bad_output',
        message:
          raw.stderr.trim().slice(0, 2000) ||
          `Could not parse a JSON envelope from the CLI (exit ${raw.code}).`,
        exitCode: raw.code,
        envelope: null,
        raw: combined
      })
    }

    if (envelope.is_error || raw.code !== 0) {
      return finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: classifyAgentError(envelope.result, envelope) ?? 'unknown',
        message: envelope.result || `claude exited ${raw.code}`,
        exitCode: raw.code,
        envelope,
        raw: combined
      })
    }

    const proposalCount = await repo.countRunProposals(runId)
    return finish(runId, run, {
      kind: 'ok',
      runId,
      result: envelope.result,
      sessionId: envelope.session_id ?? null,
      costUsd: envelope.total_cost_usd ?? null,
      durationMs: envelope.duration_ms ?? durationMs,
      proposalCount,
      envelope
    })
  }

  /** Writes the terminal agent_runs row and emits the final runUpdate. */
  async function finish(
    runId: number,
    run: ActiveRun,
    result: AgentRunResult
  ): Promise<AgentRunResult> {
    const isOk = result.kind === 'ok'
    const errorText = isOk ? null : result.message
    const envelope = result.kind === 'ok' ? result.envelope : result.envelope
    const errorKind =
      result.kind === 'ok' ? null : result.kind === 'auth' ? 'not_signed_in' : result.errorKind

    try {
      await repo.finishRun(runId, {
        finishedAt: new Date().toISOString(),
        exitCode: result.kind === 'error' ? result.exitCode : isOk ? 0 : null,
        isError: !isOk,
        errorText,
        sessionId: envelope?.session_id ?? null,
        durationMs: isOk ? result.durationMs : (envelope?.duration_ms ?? null),
        costUsd: envelope?.total_cost_usd ?? null,
        rawEnvelope: envelope
      })
    } catch {
      /* a db failure must not swallow the result the caller is waiting on */
    }

    run.update.state = isOk ? 'finished' : errorKind === 'stopped' ? 'stopped' : 'error'
    run.update.currentTool = null
    run.update.errorKind = errorKind
    run.update.errorText = errorText
    if (isOk) run.update.proposalCount = result.proposalCount
    publish(run)
    return result
  }

  function kill(run: ActiveRun): void {
    const child = run.child
    if (!child || child.killed) return
    child.kill('SIGTERM')
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, KILL_GRACE_MS).unref?.()
  }

  return {
    async spawnTriageRun(messageIds, options) {
      return begin(
        'triage',
        messageIds,
        (mcpConfigJson) =>
          buildTriageArgv({
            taskPrompt: triageTaskPrompt(messageIds.length),
            mcpConfigJson,
            model: options?.model ?? deps.model ?? DEFAULT_MODEL
          }),
        true,
        options
      )
    },

    async spawnEnrichRun(companyName, options) {
      if (deps.enrichmentEnabled === false) {
        throw new Error('Enrichment is off. Turn it on in Settings to let Claude search the web.')
      }
      // No allowlist, no bridge, no tracker tools: the company name is the entire input.
      return begin(
        'enrich',
        [],
        () =>
          buildEnrichArgv({
            taskPrompt: enrichTaskPrompt(companyName),
            model: options?.model ?? deps.model ?? DEFAULT_MODEL
          }),
        false,
        options
      )
    },

    cancelRun(runId) {
      const run = active.get(runId)
      if (!run) return
      run.stopped = true
      run.update.state = 'stopped'
      publish(run)
      kill(run)
    },

    getActiveRun() {
      let newest: AgentRunUpdate | null = null
      for (const run of active.values()) {
        if (!newest || run.update.runId > newest.runId) newest = { ...run.update }
      }
      if (newest) newest.elapsedMs = Date.now() - Date.parse(newest.startedAt)
      return newest
    },

    isClaudeAvailable() {
      if (deps.claudeBin) return existsSync(deps.claudeBin)
      return findClaudeBin() != null
    },

    async dispose() {
      for (const run of active.values()) {
        run.stopped = true
        kill(run)
      }
      active.clear()
      await bridge.stop()
    }
  }
}

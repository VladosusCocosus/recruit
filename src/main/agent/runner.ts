/**
 * Spawns the agent CLI and turns its stdout into a run row + a typed result.
 *
 * The runner owns the MCP bridge: it starts the listener, mints a per-run bearer token,
 * writes the read allowlist BEFORE the child exists, and revokes the token in a finally
 * block. A run's token is dead the moment the run ends, whether it succeeded, failed,
 * timed out, or was stopped.
 *
 * WHICH CLI is spawned is the only thing that varies, and all of it lives behind
 * AgentEngineAdapter in ./engines — locate the binary, build argv for a run kind, hand
 * back any environment that argv needs, read the output into an AgentEnvelope. Everything
 * below this line is engine-agnostic and runs identically for Claude Code and Codex.
 *
 * Two run kinds, deliberately non-overlapping:
 *   triage — tracker MCP tools and nothing else. Sees email; must not be able to send.
 *   enrich — web search, and an empty MCP config, so it cannot reach the tracker at all.
 *            Its only input is a company name; it never sees email.
 * See the header of ./engines for exactly how each engine enforces that, including the
 * one place Codex currently cannot.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { classifyAgentErrorFacts, looksLikeAuthFailure } from '@shared/agentErrors'
import {
  AGENT_ENGINE_LABEL,
  type AgentEnvelope,
  type AgentErrorKind,
  type AgentRunKind,
  type AgentRunUpdate
} from '@shared/types'
import type { AgentDeps, AgentToolCallEvent } from './deps'
import { adapterFor, type AgentEngineAdapter, type McpTarget } from './engines'
import { createMcpServer, type McpBridge } from './mcpServer'
import { enrichTaskPrompt, triageTaskPrompt } from './prompts'

/** spawn() with stdio ['ignore','pipe','pipe'] — stdin is null by construction. */
type AgentChild = ChildProcessByStdio<null, Readable, Readable>

/**
 * No wall-clock limit by default.
 *
 * This used to be five minutes, which quietly killed any real triage run: reading 70
 * messages and reasoning about them takes far longer than that, and the run died
 * mid-flight with its work discarded. A triage run is bounded by its allowlist, reports
 * progress continuously, and can be stopped from the UI at any time — a timer adds
 * nothing except a deadline to lose against. Set RunOptions.timeoutMs to re-arm one.
 */
const DEFAULT_TIMEOUT_MS = 0
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
      /** FIRST-CLASS UI STATE. Show the engine's signed-out copy, not a generic failure. */
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
  /** Whether the SELECTED engine's CLI can be found -> AppInfo.agentCliAvailable. */
  isAgentCliAvailable(): boolean
  /** Revoke every token and close the MCP listener. Call on before-quit. */
  dispose(): Promise<void>
}

/* ────────────────────────────────────────────────────────────────────────────
 * spawn environment
 * ──────────────────────────────────────────────────────────────────────────── */

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

/** Child env: inherited, PATH widened, Electron's own hooks stripped, plus the
 *  engine's extras (Codex reads the run's bearer token from one of these). */
function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['NODE_OPTIONS']
  env['PATH'] = `${env['PATH'] ?? ''}:${EXTRA_PATH()}`
  return env
}

/* ────────────────────────────────────────────────────────────────────────────
 * argv redaction
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Never persist a live bearer token. Claude Code carries it inside the --mcp-config
 * JSON blob; Codex never puts it in argv at all. The literal-token pass is the
 * belt to that JSON pattern's braces — whatever shape a future engine chooses, the
 * run's own secret cannot reach agent_runs.command_json.
 */
export function redactArgv(argv: string[], token?: string | null): string[] {
  return argv.map((a) => {
    const masked = a.replace(/"Bearer [^"]+"/g, '"Bearer ***"')
    return token ? masked.split(token).join('***') : masked
  })
}

/* ────────────────────────────────────────────────────────────────────────────
 * error classification
 * ──────────────────────────────────────────────────────────────────────────── */

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
  /** Distinct message ids opened via get_message. A Set so re-reads don't inflate it. */
  readMessages: Set<number>
  child: AgentChild | null
  timer: NodeJS.Timeout | null
  ticker: NodeJS.Timeout | null
  stopped: boolean
  timedOut: boolean
}

export function createAgentRunner(deps: AgentDeps): AgentRunner {
  const { repo } = deps
  const active = new Map<number, ActiveRun>()

  /** Read per call, not captured: Settings can switch engines while the app runs. */
  const adapter = (): AgentEngineAdapter => adapterFor(deps.engine)
  const cwd = (): string => deps.cwd ?? tmpdir()

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

  /**
   * The live ticker is driven by the MCP server, not by CLI output, so it works for
   * any engine that talks to the bridge at all — there is nothing per-engine here.
   */
  function applyToolCall(event: AgentToolCallEvent): void {
    const run = active.get(event.runId)
    if (!run) return
    if (event.phase === 'start') {
      run.update.toolCalls += 1
      run.update.currentTool = event.tool
    } else if (event.phase === 'ok') {
      if (event.proposalId != null) run.update.proposalCount += 1
      if (event.tool === 'get_message' && event.messageId != null) {
        run.readMessages.add(event.messageId)
        run.update.messagesRead = run.readMessages.size
      }
    }
    publish(run)
  }

  async function begin(
    kind: AgentRunKind,
    messageIds: number[],
    taskPrompt: string,
    needsBridge: boolean,
    options: RunOptions | undefined
  ): Promise<StartedRun> {
    const engine = adapter()
    const model = engine.resolveModel(options?.model ?? deps.model)
    const timeoutMs = options?.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

    // agent_runs.model is a record of what ran; '' would be a worse record than the
    // engine's own name for "whatever this CLI defaults to".
    const created = await repo.createRun({ kind, model: model ?? `${engine.engine}:default` })
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
        messagesTotal: messageIds.length,
        messagesRead: 0,
        errorKind: null,
        errorText: null
      },
      readMessages: new Set<number>(),
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
    let command: { argv: string[]; env: NodeJS.ProcessEnv }
    try {
      let mcp: McpTarget | null = null
      if (needsBridge) {
        await bridge.start()
        token = bridge.mintToken(runId)
        mcp = { url: bridge.mcpUrl(), token, configJson: bridge.mcpConfigJson(token) }
      }
      const input = { taskPrompt, mcp, model, cwd: cwd() }
      command = kind === 'triage' ? engine.triageCommand(input) : engine.enrichCommand(input)
      await repo.setRunCommand(runId, redactArgv(command.argv, token))
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

    const completed = execute(runId, run, engine, command, token, timeoutMs)
    return { runId, kind, startedAt: created.startedAt, completed }
  }

  async function execute(
    runId: number,
    run: ActiveRun,
    engine: AgentEngineAdapter,
    command: { argv: string[]; env: NodeJS.ProcessEnv },
    token: string | null,
    timeoutMs: number
  ): Promise<AgentRunResult> {
    const bin = deps.agentBin ?? engine.findBin() ?? engine.binaryName
    const startedMs = Date.now()

    const raw = await new Promise<{
      stdout: string
      stderr: string
      code: number | null
      spawnError: Error | null
    }>((resolve) => {
      let child: AgentChild
      try {
        child = spawn(bin, command.argv, {
          // stdin closed: the CLI warns and can hang if it stays open.
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: cwd(),
          env: childEnv(command.env),
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

      // Only arm a deadline if one was explicitly asked for. See DEFAULT_TIMEOUT_MS.
      if (timeoutMs > 0) {
        run.timer = setTimeout(() => {
          run.timedOut = true
          kill(run)
        }, timeoutMs)
      }

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
    const envelope = engine.parseResult({
      stdout: raw.stdout,
      stderr: raw.stderr,
      exitCode: raw.code
    })
    const combined = `${raw.stdout}\n${raw.stderr}`
    const label = AGENT_ENGINE_LABEL[engine.engine]

    // ── spawn-level failures ────────────────────────────────────────────────
    if (raw.spawnError) {
      const isEnoent = (raw.spawnError as NodeJS.ErrnoException).code === 'ENOENT'
      return finish(runId, run, {
        kind: 'error',
        runId,
        errorKind: isEnoent ? 'cli_missing' : 'spawn_failed',
        message: isEnoent
          ? `The ${engine.binaryName} CLI was not found (looked for "${bin}"). Install ${label}, or set the CLI path in Settings.`
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
        message: engine.notSignedInMessage,
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
          `Could not parse a result from the ${engine.binaryName} CLI (exit ${raw.code}).`,
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
        message: envelope.result || `${engine.binaryName} exited ${raw.code}`,
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
      return begin('triage', messageIds, triageTaskPrompt(messageIds.length), true, options)
    },

    async spawnEnrichRun(companyName, options) {
      if (deps.enrichmentEnabled === false) {
        throw new Error('Enrichment is off. Turn it on in Settings to let the agent search the web.')
      }
      // No allowlist, no bridge, no tracker tools: the company name is the entire input.
      return begin('enrich', [], enrichTaskPrompt(companyName), false, options)
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

    isAgentCliAvailable() {
      if (deps.agentBin) return existsSync(deps.agentBin)
      return adapter().findBin() != null
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

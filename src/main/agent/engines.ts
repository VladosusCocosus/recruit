/**
 * The engine seam: everything about a run that differs between CLIs, and nothing else.
 *
 * The runner owns the run's LIFECYCLE — run rows, the MCP bridge, minting and revoking
 * the per-run token, the ticker, cancel, timeout, finish(). An adapter owns only four
 * things: where the binary is, what argv to build for each run kind, what environment
 * that argv needs, and how to read the child's stdout back into an AgentEnvelope. Adding
 * a third CLI means adding one adapter, not touching the runner.
 *
 * The two run kinds are isolated by construction on BOTH engines, and the isolation is
 * the point — a triage run reads untrusted email, so it must have no way to send anything
 * out; an enrich run reaches the web, so it must have no way to see anything private.
 *
 *   triage  tracker MCP tools only. No shell, no file tools, no subagents, and — on
 *           Claude — no web. The user's own MCP servers are never loaded.
 *   enrich  web search only, and NO MCP server at all, so the tracker listener is
 *           unreachable. Its entire input is a company name string.
 *
 * KNOWN GAP, codex only: `codex exec` cannot turn web search off. `tools.web_search=false`
 * is accepted and does remove Codex's own web_search tool, but the ChatGPT backend still
 * exposes a server-side web tool to the model, and it answers. Verified against
 * codex-cli 0.147.0 on gpt-5.6-sol, gpt-5.5 and gpt-5.4-mini, and it is not something a
 * local flag can reach — built-in model providers cannot be overridden either. So a
 * triage run on Codex has an egress path a triage run on Claude Code does not. The flag
 * is still passed (it costs nothing and closes the gap the day Codex honours it), the
 * Settings screen says so in as many words, and Claude Code remains the default engine.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_MODELS,
  agentNotSignedInMessage,
  type AgentEngine,
  type AgentEnvelope
} from '@shared/types'
import { ENRICH_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT } from './prompts'
import { MCP_SERVER_NAME, TRACKER_ALLOWED_TOOLS, TRACKER_TOOL_NAMES } from './schemas'

/** Where the run's in-process MCP listener is, and the token that opens it. */
export interface McpTarget {
  /** http://127.0.0.1:<ephemeral port>/mcp */
  url: string
  /** Minted per run, revoked in the runner's finally block. */
  token: string
  /** The exact JSON string Claude Code's --mcp-config wants. */
  configJson: string
}

export interface CommandInput {
  taskPrompt: string
  /** null for a run that gets no tracker access — always the case for enrich. */
  mcp: McpTarget | null
  /** null => let the engine choose its own default model. */
  model: string | null
  /** The child's working directory. Codex also needs it as an explicit -C. */
  cwd: string
}

export interface EngineCommand {
  argv: string[]
  /**
   * Extra environment for the child, merged over the inherited env at spawn time.
   * Codex carries the bearer token here rather than in argv; nothing in this object
   * is ever written to agent_runs.command_json.
   */
  env: NodeJS.ProcessEnv
}

/** What the child actually produced. Both streams, because engines differ on which. */
export interface EngineOutput {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface AgentEngineAdapter {
  readonly engine: AgentEngine
  /** Absolute path to the CLI, or null when it genuinely cannot be found. */
  findBin(): string | null
  /** What `bin` should be called in an error message. */
  readonly binaryName: string
  /**
   * The model to pass, or null to omit the flag. AppSettings.model holds a Claude
   * model name, which is meaningless to any other CLI — see the codex adapter.
   */
  resolveModel(model: string | undefined): string | null
  triageCommand(input: CommandInput): EngineCommand
  enrichCommand(input: CommandInput): EngineCommand
  /** The child's output as the shared envelope shape, or null if unreadable. */
  parseResult(output: EngineOutput): AgentEnvelope | null
  readonly notSignedInMessage: string
}

/* ────────────────────────────────────────────────────────────────────────────
 * locating a CLI
 *
 * A GUI-launched .app inherits launchd's PATH, not the login shell's, so every
 * interesting install location is invisible unless we look for it by hand. The
 * composition root normally hands the runner an already-resolved path (see
 * settings.resolveAgentBinary, which searches more places and is user-overridable);
 * this is the fallback for when it could not.
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

function findOnPath(name: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const dirs = `${process.env['PATH'] ?? ''}:${EXTRA_PATH()}`.split(':').filter(Boolean)
  for (const dir of dirs) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Absolute path to the claude CLI, or null if we genuinely cannot find it. */
export function findClaudeBin(): string | null {
  return findOnPath('claude', [
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homedir(), '.bun', 'bin', 'claude'),
    join(homedir(), '.volta', 'bin', 'claude')
  ])
}

/** Absolute path to the codex CLI, or null. Usually an npm global, so often on nvm. */
export function findCodexBin(): string | null {
  return findOnPath('codex', [
    join(homedir(), '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.bun', 'bin', 'codex'),
    join(homedir(), '.volta', 'bin', 'codex'),
    join(homedir(), '.npm-global', 'bin', 'codex')
  ])
}

/* ────────────────────────────────────────────────────────────────────────────
 * claude code
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

const CLAUDE_DEFAULT_MODEL = 'sonnet'

export const claudeAdapter: AgentEngineAdapter = {
  engine: 'claude',
  binaryName: 'claude',
  findBin: findClaudeBin,
  notSignedInMessage: agentNotSignedInMessage('claude'),

  resolveModel(model) {
    return model ?? CLAUDE_DEFAULT_MODEL
  },

  triageCommand({ taskPrompt, mcp, model }) {
    return {
      argv: buildTriageArgv({
        taskPrompt,
        mcpConfigJson: mcp?.configJson ?? '{"mcpServers":{}}',
        model: model ?? CLAUDE_DEFAULT_MODEL
      }),
      env: {}
    }
  },

  enrichCommand({ taskPrompt, model }) {
    return {
      argv: buildEnrichArgv({ taskPrompt, model: model ?? CLAUDE_DEFAULT_MODEL }),
      env: {}
    }
  },

  parseResult({ stdout }) {
    return parseEnvelope(stdout)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * codex
 *
 * Verified against codex-cli 0.147.0. Codex has no --system-prompt, no
 * --allowedTools and no --mcp-config; it is configured entirely through dotted
 * TOML overrides (-c key=value) layered on ~/.codex/config.toml, which is why
 * --ignore-user-config matters so much here: without it a triage run would load
 * the user's OWN MCP servers into a process that can read their email.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The env var Codex reads the tracker bearer token from. Never in argv. */
export const CODEX_TOKEN_ENV_VAR = 'RECRUIT_MCP_TOKEN'

/** TOML scalar/array literals for -c. Every value we pass is plain ASCII. */
const tomlStr = (value: string): string => JSON.stringify(value)
const tomlArr = (values: readonly string[]): string =>
  `[${values.map((v) => JSON.stringify(v)).join(',')}]`

/**
 * Codex feature flags that hand the model a tool neither run kind may have.
 * `--disable <feature>` is `-c features.<name>=false`; a name this build does not
 * know is ignored rather than fatal, so listing a few extra costs nothing.
 */
const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'image_generation',
  'apps',
  'collaboration_modes'
] as const

/**
 * The flags both run kinds share.
 *   --ignore-user-config  the user's ~/.codex/config.toml — and so their own MCP
 *                         servers — is not loaded into a run that reads their mail.
 *   --ignore-rules        no user or project execpolicy .rules files either.
 *   -s read-only          the sandbox cannot write, even if a tool did appear.
 *   --ephemeral           no session file is left on disk. Transcripts of a triage
 *                         run are the user's email; it does not get persisted.
 *   -C <cwd>              a scratch dir, never the user's repo, so no AGENTS.md and
 *                         no project files are in scope.
 */
function codexBaseArgv(cwd: string): string[] {
  return [
    'exec',
    '--json',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
    '-C',
    cwd,
    '-s',
    'read-only',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['--disable', f])
  ]
}

/**
 * Codex has no --system-prompt, so the system prompt is folded into the single
 * positional prompt. The task half is fenced off explicitly because on a triage run
 * it is the only part that will end up quoting untrusted mail.
 */
export function codexPrompt(systemPrompt: string, taskPrompt: string): string {
  return `${systemPrompt}\n\n---\n\n# Your task\n\n${taskPrompt}`
}

export function buildCodexTriageArgv(input: {
  taskPrompt: string
  mcpUrl: string
  cwd: string
  model: string | null
}): string[] {
  const server = `mcp_servers.${MCP_SERVER_NAME}`
  return [
    ...codexBaseArgv(input.cwd),
    // No web, no image reading. See the KNOWN GAP at the top of this file: Codex
    // does not currently honour this one, but it is the documented switch.
    '-c',
    'tools.web_search=false',
    '-c',
    'tools.view_image=false',
    // Belt and braces for the token: the shell tool is already disabled above, but
    // if one ever came back it would not inherit the bearer token.
    '-c',
    `shell_environment_policy.exclude=${tomlArr([CODEX_TOKEN_ENV_VAR])}`,
    '-c',
    `${server}.url=${tomlStr(input.mcpUrl)}`,
    // The token travels by env var, so it never reaches argv or command_json.
    '-c',
    `${server}.bearer_token_env_var=${tomlStr(CODEX_TOKEN_ENV_VAR)}`,
    // `codex exec` is non-interactive, so any tool call that asks for approval is
    // auto-CANCELLED. Without this every tracker call fails with "user cancelled
    // MCP tool call". It approves calls to THIS server only.
    '-c',
    `${server}.default_tools_approval_mode="approve"`,
    // The per-server allowlist — Codex's analogue of --allowedTools.
    '-c',
    `${server}.enabled_tools=${tomlArr(TRACKER_TOOL_NAMES)}`,
    ...(input.model ? ['-m', input.model] : []),
    codexPrompt(TRIAGE_SYSTEM_PROMPT, input.taskPrompt)
  ]
}

/**
 * Enrich: web search on, and not one `mcp_servers.*` override. Combined with
 * --ignore-user-config that leaves the run with zero MCP servers of any kind, so
 * the tracker listener is not merely un-allowed, it is unaddressable.
 */
export function buildCodexEnrichArgv(input: {
  taskPrompt: string
  cwd: string
  model: string | null
}): string[] {
  return [
    ...codexBaseArgv(input.cwd),
    '-c',
    'tools.web_search=true',
    '-c',
    'tools.view_image=false',
    ...(input.model ? ['-m', input.model] : []),
    codexPrompt(ENRICH_SYSTEM_PROMPT, input.taskPrompt)
  ]
}

/* ── codex output ────────────────────────────────────────────────────────── */

interface CodexEvent {
  type?: string
  thread_id?: string
  message?: string
  error?: { message?: string }
  usage?: Record<string, unknown>
  item?: { type?: string; text?: string; message?: string }
}

/**
 * `codex exec --json` streams JSONL events, not one envelope, so this folds the
 * stream down to the same AgentEnvelope shape the rest of the app already reads.
 * --output-last-message would have given the reply on its own, but only the reply:
 * the thread id, the failure reason and the token usage all live in the stream, and
 * a temp file is one more thing to clean up on a killed run.
 *
 * Unparseable lines are skipped rather than fatal — a warning printed before the
 * first event must not cost us the whole run.
 */
export function parseCodexEvents(stdout: string, stderr = ''): AgentEnvelope | null {
  let sessionId = ''
  let lastMessage: string | null = null
  let turnFailure: string | null = null
  /** `error` events are also emitted for retries that then succeed. Advisory only. */
  let lastSoftError: string | null = null
  let usage: Record<string, unknown> | undefined
  let sawEvent = false

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event: CodexEvent
    try {
      event = JSON.parse(trimmed) as CodexEvent
    } catch {
      continue
    }
    sawEvent = true
    switch (event.type) {
      case 'thread.started':
        if (typeof event.thread_id === 'string') sessionId = event.thread_id
        break
      case 'item.completed':
        if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
          lastMessage = event.item.text
        } else if (event.item?.type === 'error' && typeof event.item.message === 'string') {
          lastSoftError = event.item.message
        }
        break
      case 'turn.completed':
        if (event.usage) usage = event.usage
        break
      case 'turn.failed':
        turnFailure = event.error?.message ?? 'The Codex run failed.'
        break
      case 'error':
        if (typeof event.message === 'string') lastSoftError = event.message
        break
      default:
        break
    }
  }

  if (!sawEvent) return null

  // A turn that ended with a reply succeeded, however noisy the retries were on the
  // way; only turn.failed, or a turn that never spoke at all, is a failure.
  const isError = turnFailure !== null || lastMessage === null
  const result = isError
    ? (turnFailure ?? lastSoftError ?? (stderr.trim() || 'Codex produced no reply.'))
    : (lastMessage ?? '')
  return {
    type: 'result',
    is_error: isError,
    result,
    session_id: sessionId,
    ...(usage ? { usage } : {})
  }
}

export const codexAdapter: AgentEngineAdapter = {
  engine: 'codex',
  binaryName: 'codex',
  findBin: findCodexBin,
  notSignedInMessage: agentNotSignedInMessage('codex'),

  /**
   * AppSettings.model holds a Claude model name ("sonnet"), which Codex would
   * reject outright. Drop it and let Codex use its own configured default; an
   * explicit RunOptions.model still comes through.
   */
  resolveModel(model) {
    if (!model) return null
    return (AGENT_MODELS as readonly string[]).includes(model) ? null : model
  },

  triageCommand({ taskPrompt, mcp, model, cwd }) {
    if (!mcp) throw new Error('A Codex triage run needs the tracker MCP bridge.')
    return {
      argv: buildCodexTriageArgv({ taskPrompt, mcpUrl: mcp.url, cwd, model }),
      env: { [CODEX_TOKEN_ENV_VAR]: mcp.token }
    }
  },

  enrichCommand({ taskPrompt, model, cwd }) {
    return {
      argv: buildCodexEnrichArgv({ taskPrompt, cwd, model }),
      env: {}
    }
  },

  parseResult({ stdout, stderr }) {
    return parseCodexEvents(stdout, stderr)
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

const ADAPTERS: Record<AgentEngine, AgentEngineAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter
}

export function adapterFor(engine: AgentEngine | undefined): AgentEngineAdapter {
  return ADAPTERS[engine ?? 'claude'] ?? claudeAdapter
}

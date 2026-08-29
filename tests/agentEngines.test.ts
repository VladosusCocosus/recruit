import { describe, expect, it } from 'vitest'
import { TRACKER_TOOL_NAMES } from '@main/agent/schemas'
import {
  buildCodexEnrichArgv,
  buildCodexTriageArgv,
  buildEnrichArgv,
  codexAdapter,
  CODEX_TOKEN_ENV_VAR,
  ENRICH_TOOLS,
  parseCodexEvents
} from '@main/agent/engines'
import { redactArgv } from '@main/agent/runner'

const TOKEN = 'sekrit-token-abc123'
const URL = 'http://127.0.0.1:54321/mcp'
const CWD = '/tmp/jobbox-agent'

function triage(model: string | null = null): string[] {
  return buildCodexTriageArgv({ taskPrompt: 'Triage the 3 messages.', mcpUrl: URL, cwd: CWD, model })
}

function enrich(model: string | null = null): string[] {
  return buildCodexEnrichArgv({ taskPrompt: 'Write the brief for: Acme', cwd: CWD, model })
}

/** The value of `-c <key>=<value>`, or undefined when the key was never passed. */
function override(argv: string[], key: string): string | undefined {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] !== '-c') continue
    const eq = argv[i + 1].indexOf('=')
    if (eq > 0 && argv[i + 1].slice(0, eq) === key) return argv[i + 1].slice(eq + 1)
  }
  return undefined
}

const disabled = (argv: string[]): string[] =>
  argv.flatMap((a, i) => (argv[i - 1] === '--disable' ? [a] : []))

describe('codex triage argv', () => {
  it('locks the run down: read-only, no user config, no user rules, nothing persisted', () => {
    const argv = triage()
    expect(argv[0]).toBe('exec')
    expect(argv).toContain('--ignore-user-config')
    expect(argv).toContain('--ignore-rules')
    expect(argv).toContain('--ephemeral')
    expect(argv.slice(argv.indexOf('-s'), argv.indexOf('-s') + 2)).toEqual(['-s', 'read-only'])
    expect(argv.slice(argv.indexOf('-C'), argv.indexOf('-C') + 2)).toEqual(['-C', CWD])
  })

  it('takes away every tool that could reach the shell, the machine, or a subagent', () => {
    const off = disabled(triage())
    for (const feature of ['shell_tool', 'unified_exec', 'browser_use', 'computer_use', 'apps']) {
      expect(off).toContain(feature)
    }
    // A subagent would inherit none of these flags, so it must not be spawnable.
    expect(off).toContain('collaboration_modes')
  })

  it('asks for the tracker server by url and allowlists exactly the tracker tools', () => {
    const argv = triage()
    expect(override(argv, 'mcp_servers.tracker.url')).toBe(JSON.stringify(URL))
    expect(override(argv, 'mcp_servers.tracker.enabled_tools')).toBe(
      JSON.stringify([...TRACKER_TOOL_NAMES])
    )
    // codex exec is non-interactive: without this every tracker call is auto-cancelled.
    expect(override(argv, 'mcp_servers.tracker.default_tools_approval_mode')).toBe('"approve"')
  })

  it('never puts the bearer token in argv — it travels by environment variable', () => {
    const command = codexAdapter.triageCommand({
      taskPrompt: 'Triage.',
      mcp: { url: URL, token: TOKEN, configJson: '{}' },
      model: null,
      cwd: CWD
    })
    expect(command.argv.join('\u0000')).not.toContain(TOKEN)
    expect(command.env[CODEX_TOKEN_ENV_VAR]).toBe(TOKEN)
    expect(override(command.argv, 'mcp_servers.tracker.bearer_token_env_var')).toBe(
      JSON.stringify(CODEX_TOKEN_ENV_VAR)
    )
    // and the token is kept out of any shell the model might somehow acquire
    expect(override(command.argv, 'shell_environment_policy.exclude')).toBe(
      JSON.stringify([CODEX_TOKEN_ENV_VAR])
    )
  })

  it('folds the system prompt into the single positional prompt, which comes last', () => {
    const argv = triage()
    const prompt = argv[argv.length - 1]
    expect(prompt.startsWith('-')).toBe(false)
    expect(prompt).toContain('triage agent inside Recruit')
    expect(prompt).toContain('Triage the 3 messages.')
  })

  it('omits -m for a Claude model name and passes a real one through', () => {
    expect(codexAdapter.resolveModel('sonnet')).toBeNull()
    expect(codexAdapter.resolveModel(undefined)).toBeNull()
    expect(codexAdapter.resolveModel('gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(triage(null)).not.toContain('-m')
    expect(triage('gpt-5.6-sol').slice(-3, -1)).toEqual(['-m', 'gpt-5.6-sol'])
  })
})

describe('codex enrich argv', () => {
  it('configures no MCP server at all, so the tracker is unaddressable', () => {
    const argv = enrich()
    expect(argv.filter((a) => a.startsWith('mcp_servers.'))).toEqual([])
    expect(argv).toContain('--ignore-user-config')
  })

  it('is the only run kind that asks for the web', () => {
    expect(override(enrich(), 'tools.web_search')).toBe('true')
    expect(override(triage(), 'tools.web_search')).toBe('false')
  })
})

describe('claude enrich argv', () => {
  const argv = buildEnrichArgv({ taskPrompt: 'Write the brief for: Acme', model: 'sonnet' })
  const flag = (name: string): string | undefined => argv[argv.indexOf(name) + 1]

  it('grants web reads and nothing else, on both the tool and the permission flag', () => {
    expect(ENRICH_TOOLS).toBe('WebSearch,WebFetch')
    expect(flag('--tools')).toBe(ENRICH_TOOLS)
    expect(flag('--allowedTools')).toBe(ENRICH_TOOLS)
    for (const forbidden of ['Bash', 'Read', 'Write', 'Edit', 'Task']) {
      expect(ENRICH_TOOLS.split(',')).not.toContain(forbidden)
    }
  })

  it('configures no MCP server at all, so the tracker is unaddressable', () => {
    expect(flag('--mcp-config')).toBe('{"mcpServers":{}}')
    expect(argv).toContain('--strict-mcp-config')
  })
})

describe('parseCodexEvents', () => {
  const line = (o: unknown): string => JSON.stringify(o)

  it('folds a successful JSONL stream into the shared envelope shape', () => {
    const envelope = parseCodexEvents(
      [
        line({ type: 'thread.started', thread_id: 'thr_1' }),
        line({ type: 'turn.started' }),
        line({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call' } }),
        line({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Proposed 2 items.' } }),
        line({ type: 'turn.completed', usage: { input_tokens: 100 } })
      ].join('\n')
    )
    expect(envelope).toMatchObject({
      is_error: false,
      result: 'Proposed 2 items.',
      session_id: 'thr_1',
      usage: { input_tokens: 100 }
    })
  })

  it('takes the LAST agent message, not the first', () => {
    const envelope = parseCodexEvents(
      [
        line({ type: 'item.completed', item: { type: 'agent_message', text: 'Working on it.' } }),
        line({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }),
        line({ type: 'turn.completed' })
      ].join('\n')
    )
    expect(envelope?.result).toBe('Done.')
  })

  it('reports turn.failed as an error', () => {
    const envelope = parseCodexEvents(
      [
        line({ type: 'thread.started', thread_id: 'thr_2' }),
        line({ type: 'turn.failed', error: { message: '401 Unauthorized from api.openai.com' } })
      ].join('\n')
    )
    expect(envelope?.is_error).toBe(true)
    expect(envelope?.result).toContain('401 Unauthorized')
  })

  it('does not fail a run over retries that eventually succeeded', () => {
    const envelope = parseCodexEvents(
      [
        line({ type: 'error', message: 'Reconnecting... 2/5' }),
        line({ type: 'item.completed', item: { type: 'agent_message', text: 'Fine in the end.' } }),
        line({ type: 'turn.completed' })
      ].join('\n')
    )
    expect(envelope?.is_error).toBe(false)
    expect(envelope?.result).toBe('Fine in the end.')
  })

  it('survives noise before the first event, and gives up on no events at all', () => {
    const envelope = parseCodexEvents(
      ['(node) ExperimentalWarning: blah', 'not json', line({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })].join('\n')
    )
    expect(envelope?.result).toBe('ok')
    expect(parseCodexEvents('')).toBeNull()
    expect(parseCodexEvents('total nonsense\n')).toBeNull()
  })
})

describe('redactArgv', () => {
  it('masks the token inside a Claude --mcp-config blob', () => {
    const argv = redactArgv([
      '--mcp-config',
      `{"mcpServers":{"tracker":{"headers":{"Authorization":"Bearer ${TOKEN}"}}}}`
    ])
    expect(argv.join(' ')).not.toContain(TOKEN)
    expect(argv[1]).toContain('"Bearer ***"')
  })

  it('masks a bare token wherever it appears, whatever shape the engine chose', () => {
    const argv = redactArgv(['-c', `some.key=${TOKEN}`, TOKEN], TOKEN)
    expect(argv).toEqual(['-c', 'some.key=***', '***'])
  })

  it('leaves an argv with no secret in it alone', () => {
    const argv = triage()
    expect(redactArgv(argv, TOKEN)).toEqual(argv)
  })
})

/**
 * Writing the Jobbox server into the MCP clients installed on this Mac.
 *
 * Jobbox owns one key — `mcpServers.jobbox` — inside a file another application owns, so
 * every write parses what is there, merges, backs the file up and replaces it atomically.
 * A config that does not parse is never rewritten.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { McpClient, McpClientId, McpStatus } from '@shared/types'
import { defaultDbPath, getDbPath } from '../db/connection'
import { settingsPath } from '../settings'
import { addServer, dropServer, hasServer } from './configFile'

/** The key Jobbox writes. Anything else in the file is left untouched. */
export const SERVER_KEY = 'jobbox'

export interface LaunchSpec {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

interface ClientDef {
  id: McpClientId
  label: string
  /** The config file Jobbox writes, or null when the client owns its own file. */
  file: string | null
  /** Evidence the client is installed at all. */
  marker: string
}

function clients(): ClientDef[] {
  const home = homedir()
  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      file: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
      marker: join(home, 'Library/Application Support/Claude')
    },
    {
      id: 'cursor',
      label: 'Cursor',
      file: join(home, '.cursor/mcp.json'),
      marker: join(home, '.cursor')
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      file: null,
      marker: join(home, '.claude')
    }
  ]
}

/** The built server entry inside this bundle. */
export function serverEntryPath(): string {
  return join(app.getAppPath(), 'out', 'main', 'mcp.js')
}

export function launchSpec(): LaunchSpec {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [serverEntryPath()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      JOBBOX_DB_PATH: getDbPath() ?? defaultDbPath(),
      JOBBOX_SETTINGS_PATH: settingsPath()
    }
  }
}

/** The block to paste into a client Jobbox cannot write for itself. */
export function snippet(): string {
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: launchSpec() } }, null, 2)
}

/** What a Claude Code user runs instead, since its CLI owns that file. */
export function claudeCodeCommand(): string {
  const json = JSON.stringify(launchSpec()).replaceAll("'", `'\\''`)
  return `claude mcp add-json ${SERVER_KEY} '${json}' --scope user`
}

function definition(id: McpClientId): ClientDef {
  const def = clients().find((c) => c.id === id)
  if (!def) throw new Error(`Unknown MCP client: ${id}`)
  return def
}

function describe(def: ClientDef): McpClient {
  const detected = existsSync(def.marker)
  let installed = false
  let error: string | null = null
  if (def.file) {
    try {
      installed = hasServer(def.file, SERVER_KEY)
    } catch (e) {
      error = `Jobbox can't edit ${def.file}: ${e instanceof Error ? e.message : String(e)}. Paste the snippet below instead.`
    }
  }
  return {
    id: def.id,
    label: def.label,
    configPath: def.file,
    detected,
    installed,
    command: def.file ? null : claudeCodeCommand(),
    error
  }
}

export function status(): McpStatus {
  return {
    clients: clients().map(describe),
    snippet: snippet(),
    ready: existsSync(serverEntryPath())
  }
}

/** Adds (or refreshes) the Jobbox entry in one client's config. */
export function install(id: McpClientId): McpStatus {
  const def = definition(id)
  if (!def.file) throw new Error(`${def.label} manages its own configuration.`)
  addServer(def.file, SERVER_KEY, launchSpec())
  return status()
}

export function remove(id: McpClientId): McpStatus {
  const def = definition(id)
  if (!def.file) throw new Error(`${def.label} manages its own configuration.`)
  dropServer(def.file, SERVER_KEY)
  return status()
}

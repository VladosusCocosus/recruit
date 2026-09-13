/**
 * The MCP server users point their own AI client at: one stdio process, read-only over
 * the Jobbox database.
 *
 * It is spawned as `<Jobbox binary> <this file>` with ELECTRON_RUN_AS_NODE=1, which runs
 * plain Node on Electron's ABI and so loads the better-sqlite3 build shipped inside the
 * app. stdout belongs to the transport; diagnostics go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { closeDatabase } from '../db/connection'
import {
  DB_PATH_ENV,
  openTrackerDatabase,
  resolveDbPath,
  resolveSettingsPath,
  serverEnabled
} from './database'
import { createTrackerServer } from './tools'

const DISABLED =
  'Jobbox is not sharing data with AI assistants. Turn on “Allow AI assistants to read Jobbox” in Jobbox → Settings → Assistants.'

async function main(): Promise<void> {
  const dbPath = resolveDbPath()
  const settingsPath = resolveSettingsPath()

  let unavailable: string | null = null
  if (!dbPath) {
    unavailable = `${DB_PATH_ENV} is not set, so this server does not know which Jobbox database to read. Re-add Jobbox from its Settings → Assistants pane.`
  } else {
    const outcome = openTrackerDatabase(dbPath)
    if (!outcome.ok) unavailable = outcome.error
  }
  if (unavailable) console.error(`[jobbox-mcp] ${unavailable}`)

  const server = createTrackerServer(() => {
    if (unavailable) return unavailable
    return serverEnabled(settingsPath) ? null : DISABLED
  })

  await server.connect(new StdioServerTransport())

  const shutdown = (): void => {
    void server.close().catch(() => undefined)
    closeDatabase()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((error: unknown) => {
  console.error(`[jobbox-mcp] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

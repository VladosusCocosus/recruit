import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseCtor from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, openDatabase } from '@main/db/connection'
import { LATEST_VERSION } from '@main/db/migrations'
import { createItem } from '@main/db/repos/items'
import { addServer, dropServer, readConfig } from '@main/mcp/configFile'
import { openTrackerDatabase, serverEnabled } from '@main/mcp/database'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobbox-mcp-'))
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

const dbPath = (): string => join(dir, 'recruit.db')

/** A database at the current schema, with one application in it. */
function seedDatabase(): void {
  openDatabase({ path: dbPath(), reopen: true })
  createItem({ company: 'Northwind', role: 'Platform Engineer', statusKey: 'applied' })
  closeDatabase()
}

describe('client config files', () => {
  const file = (): string => join(dir, 'claude_desktop_config.json')

  it('keeps every other server and top-level key', () => {
    writeFileSync(
      file(),
      JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }),
      'utf8'
    )

    addServer(file(), 'jobbox', { command: 'jobbox-bin' })

    const config = readConfig(file())
    expect(config['theme']).toBe('dark')
    expect(config.mcpServers?.['other']).toEqual({ command: 'x' })
    expect(config.mcpServers?.['jobbox']).toEqual({ command: 'jobbox-bin' })
  })

  it('backs the file up before replacing it', () => {
    writeFileSync(file(), JSON.stringify({ mcpServers: {} }), 'utf8')
    addServer(file(), 'jobbox', { command: 'jobbox-bin' })
    expect(existsSync(`${file()}.jobbox.bak`)).toBe(true)
  })

  it('removes only the Jobbox entry', () => {
    writeFileSync(
      file(),
      JSON.stringify({ mcpServers: { other: { command: 'x' }, jobbox: { command: 'y' } } }),
      'utf8'
    )
    dropServer(file(), 'jobbox')
    const config = readConfig(file())
    expect(config.mcpServers?.['other']).toEqual({ command: 'x' })
    expect(config.mcpServers?.['jobbox']).toBeUndefined()
  })

  it('refuses to rewrite a config it cannot parse', () => {
    writeFileSync(file(), '{ not json', 'utf8')
    expect(() => addServer(file(), 'jobbox', {})).toThrow()
    expect(readFileSync(file(), 'utf8')).toBe('{ not json')
  })
})

describe('openTrackerDatabase', () => {
  it('rejects every write once open', () => {
    seedDatabase()
    expect(openTrackerDatabase(dbPath()).ok).toBe(true)
    expect(() => getDb().exec('CREATE TABLE probe (x)')).toThrow(/readonly|query_only/i)
    expect(() => getDb().exec("UPDATE items SET company = 'x'")).toThrow(/readonly|query_only/i)
  })

  it('reports a database that has not been migrated yet', () => {
    const db = new DatabaseCtor(dbPath())
    db.pragma(`user_version = ${LATEST_VERSION - 1}`)
    db.close()

    const outcome = openTrackerDatabase(dbPath())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toMatch(/Open Jobbox once/i)
  })

  it('reports a database written by a newer build', () => {
    const db = new DatabaseCtor(dbPath())
    db.pragma(`user_version = ${LATEST_VERSION + 1}`)
    db.close()

    const outcome = openTrackerDatabase(dbPath())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toMatch(/newer Jobbox/i)
  })

  it('reports a database that is not there', () => {
    const outcome = openTrackerDatabase(join(dir, 'missing.db'))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toMatch(/No Jobbox database/i)
  })
})

describe('serverEnabled', () => {
  it('is off when the settings file has no answer in it', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ theme: 'dark' }), 'utf8')
    expect(serverEnabled(file)).toBe(false)
    expect(serverEnabled(join(dir, 'nothing.json'))).toBe(false)
    expect(serverEnabled(null)).toBe(false)
  })
})

/* ── the built server, spoken to the way a client speaks to it ───────────── */

const ENTRY = join(process.cwd(), 'out/main/mcp.js')
const ELECTRON = join(
  process.cwd(),
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)
const built = existsSync(ENTRY) && existsSync(ELECTRON)

describe.runIf(built)('the shipped stdio server', () => {
  it('serves the tracker, and stops the moment the user revokes access', async () => {
    seedDatabase()
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, JSON.stringify({ mcpServerEnabled: true }), 'utf8')

    const client = new Client({ name: 'jobbox-test', version: '1.0.0' })
    await client.connect(
      new StdioClientTransport({
        command: ELECTRON,
        args: [ENTRY],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          JOBBOX_DB_PATH: dbPath(),
          JOBBOX_SETTINGS_PATH: settings,
          PATH: process.env['PATH'] ?? ''
        }
      })
    )

    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(tools).toEqual([
        'get_application',
        'get_message',
        'get_stats',
        'get_upcoming',
        'list_applications',
        'search_messages'
      ])

      const listed = await client.callTool({ name: 'list_applications', arguments: {} })
      const text = (listed.content as Array<{ text: string }>)[0].text
      expect(listed.isError).toBeFalsy()
      expect(JSON.parse(text).applications[0].company).toBe('Northwind')

      writeFileSync(settings, JSON.stringify({ mcpServerEnabled: false }), 'utf8')

      const revoked = await client.callTool({ name: 'list_applications', arguments: {} })
      expect(revoked.isError).toBe(true)
      expect((revoked.content as Array<{ text: string }>)[0].text).toMatch(/not sharing data/i)
    } finally {
      await client.close()
    }
  }, 30_000)
})

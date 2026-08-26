/**
 * The single SQLite connection. There is exactly ONE writer in the app and it lives in
 * the Electron main process — the MCP server is spawned in-process for this reason.
 *
 * Public entry points are re-exported from `@main/db`; import from there, not from here.
 */
import DatabaseCtor from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runMigrations } from './migrations'

export type DatabaseHandle = DatabaseCtor.Database
type AnyStatement = DatabaseCtor.Statement<unknown[], unknown>

export interface OpenDatabaseOptions {
  /** Overrides the default userData path. Also honoured: process.env.RECRUIT_DB_PATH. */
  path?: string
  /** Re-open even if a handle already exists (closes the old one first). */
  reopen?: boolean
  verbose?: (message?: unknown, ...rest: unknown[]) => void
}

let handle: DatabaseHandle | null = null
let dbPath: string | null = null
const statements = new Map<string, AnyStatement>()

/** userData/recruit.db. Resolved lazily so this module is importable outside Electron. */
export function defaultDbPath(): string {
  const override = process.env['RECRUIT_DB_PATH']
  if (override) return override
  // Lazy require: keeps `electron` off the import graph for anything that only needs types.
  const { app } = require('electron') as typeof import('electron')
  return join(app.getPath('userData'), 'recruit.db')
}

/** Opens (or returns) the connection, enables WAL, and runs pending migrations. */
export function openDatabase(options: OpenDatabaseOptions = {}): DatabaseHandle {
  if (handle && !options.reopen) return handle
  if (handle) closeDatabase()

  const path = options.path ?? defaultDbPath()
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseCtor(path, options.verbose ? { verbose: options.verbose } : {})
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')

  runMigrations(db)

  handle = db
  dbPath = path
  return db
}

export function getDb(): DatabaseHandle {
  if (!handle) throw new Error('Database is not open. Call openDatabase() during app startup.')
  return handle
}

export function isDatabaseOpen(): boolean {
  return handle !== null && handle.open
}

export function getDbPath(): string | null {
  return dbPath
}

/** Flush the WAL. Call from app `before-quit`. */
export function checkpoint(): void {
  if (handle?.open) handle.pragma('wal_checkpoint(TRUNCATE)')
}

export function closeDatabase(): void {
  statements.clear()
  if (handle?.open) {
    handle.pragma('wal_checkpoint(TRUNCATE)')
    handle.close()
  }
  handle = null
  dbPath = null
}

/* ── query helpers ──────────────────────────────────────────────────────────
 * Prepared statements are cached by SQL text, so repos can just write the query
 * inline without hoisting a module-level `prepare` for every one of them.
 * ─────────────────────────────────────────────────────────────────────────── */

function prepare(sql: string, pluck = false): AnyStatement {
  const key = pluck ? `p:${sql}` : sql
  let stmt = statements.get(key)
  if (!stmt) {
    stmt = getDb().prepare<unknown[], unknown>(sql)
    if (pluck) stmt.pluck(true)
    statements.set(key, stmt)
  }
  return stmt
}

/** First row, or undefined. */
export function queryOne<T>(sql: string, ...params: unknown[]): T | undefined {
  return prepare(sql).get(...params) as T | undefined
}

/** All rows. */
export function queryAll<T>(sql: string, ...params: unknown[]): T[] {
  return prepare(sql).all(...params) as T[]
}

/** INSERT / UPDATE / DELETE. */
export function execute(sql: string, ...params: unknown[]): DatabaseCtor.RunResult {
  return prepare(sql).run(...params)
}

/** First column of the first row. */
export function scalar<T>(sql: string, ...params: unknown[]): T | undefined {
  return prepare(sql, true).get(...params) as T | undefined
}

/** `SELECT count(*)` convenience — returns 0 rather than undefined. */
export function count(sql: string, ...params: unknown[]): number {
  return Number(scalar<number>(sql, ...params) ?? 0)
}

/**
 * Run `fn` in a transaction. Nested calls become SAVEPOINTs (better-sqlite3 handles
 * this), so a repo can wrap its own work without caring whether it was already inside
 * an outer transaction — that is what makes per-proposal rollback in the applier work.
 */
export function transact<T>(fn: () => T): T {
  return getDb().transaction(fn)()
}

/** Escape a LIKE pattern and wrap it in wildcards. Pair with `ESCAPE '\'` in the SQL. */
export function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Build a `(?, ?, ?)` placeholder list. */
export function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ')
}

/**
 * The user-facing server's handle on the app's data: the same SQLite file the app writes,
 * opened without migrations and with every write blocked.
 */
import { existsSync, readFileSync } from 'node:fs'
import { closeDatabase, getDb, openDatabase } from '../db/connection'
import { LATEST_VERSION } from '../db/migrations'

export const DB_PATH_ENV = 'JOBBOX_DB_PATH'
export const SETTINGS_PATH_ENV = 'JOBBOX_SETTINGS_PATH'

export type OpenOutcome = { ok: true; version: number } | { ok: false; error: string }

/** The database path from the environment the client spawned this process with. */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[DB_PATH_ENV] ?? env['RECRUIT_DB_PATH'] ?? null
}

export function resolveSettingsPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[SETTINGS_PATH_ENV] ?? null
}

/**
 * Opens `path` query-only, then checks its schema against this build. Returns the reason
 * the database cannot be served instead of throwing, so the server can start anyway and
 * answer every tool call with it.
 */
export function openTrackerDatabase(path: string): OpenOutcome {
  if (path !== ':memory:' && !existsSync(path)) {
    return {
      ok: false,
      error: `No Jobbox database at ${path}. Open Jobbox, add a mail account and sync once.`
    }
  }

  try {
    openDatabase({ path, migrate: false, queryOnly: true, reopen: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Could not open the Jobbox database at ${path}: ${detail}` }
  }

  const version = Number(getDb().pragma('user_version', { simple: true }) ?? 0)
  if (version === 0) {
    closeDatabase()
    return {
      ok: false,
      error: `The Jobbox database at ${path} is empty. Open Jobbox and sync a mail account first.`
    }
  }
  if (version < LATEST_VERSION) {
    closeDatabase()
    return {
      ok: false,
      error: `The Jobbox database is at schema ${version} and this build reads ${LATEST_VERSION}. Open Jobbox once to finish upgrading it.`
    }
  }
  if (version > LATEST_VERSION) {
    closeDatabase()
    return {
      ok: false,
      error: `The Jobbox database was written by a newer Jobbox (schema ${version}); this server reads ${LATEST_VERSION}. Point your client at the current Jobbox bundle, or update Jobbox.`
    }
  }
  return { ok: true, version }
}

/**
 * Whether the user still has MCP access switched on, read fresh from settings.json on
 * every call so revoking it in Jobbox takes effect without restarting the client. A
 * missing file or key reads as off.
 */
export function serverEnabled(settingsPath: string | null): boolean {
  if (!settingsPath || !existsSync(settingsPath)) return false
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    return raw['mcpServerEnabled'] === true
  } catch {
    return false
  }
}

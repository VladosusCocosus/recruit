import { rmSync } from 'node:fs'
import type Database from 'better-sqlite3'
import * as m001 from './001_init'
import * as m002 from './002_message_read_at'
import * as m003 from './003_message_deleted_at'
import * as m004 from './004_resumes'
import * as m005 from './005_call_debrief'
import * as m006 from './006_apply_flow'
import * as m007 from './007_markdown_resumes'
import * as m008 from './008_documents_and_answers'
import * as m009 from './009_folder_cursors'

export interface Migration {
  version: number
  name: string
  /** True when the migration drops a column or a table, so it cannot be undone. */
  destructive?: boolean
  up: (db: Database.Database) => void
}

/** Ordered. Append new migrations; never renumber or edit a shipped one. */
export const MIGRATIONS: readonly Migration[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009]

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

/** Where `runMigrations` copies a database before the first destructive migration. */
export function backupPathFor(dbPath: string, version: number): string {
  return `${dbPath}.v${version}.bak`
}

/**
 * Snapshots the database next to itself. `VACUUM INTO` writes one consistent file, so the
 * copy does not depend on the WAL sidecar. Returns the path, or null for `:memory:`.
 */
function backupDatabase(db: Database.Database, version: number): string | null {
  if (db.memory) return null
  const target = backupPathFor(db.name, version)
  rmSync(target, { force: true })
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  return target
}

/**
 * Runs every migration newer than PRAGMA user_version. Returns the versions applied.
 *
 * Throws when the database is newer than this build, and when a destructive migration is
 * pending but the database cannot be copied first.
 */
export function runMigrations(db: Database.Database): number[] {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0)
  if (current > LATEST_VERSION) {
    throw new Error(
      `This database was written by a newer version of Jobbox (schema ${current}; this build reads ${LATEST_VERSION}). ` +
        'Install the latest version to open it.'
    )
  }

  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  if (pending.some((m) => m.destructive)) {
    let target: string | null
    try {
      target = backupDatabase(db, current)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `This upgrade cannot be undone, so Jobbox copies your database first — and the copy failed: ${detail}. ` +
          'Free some disk space and open Jobbox again.'
      )
    }
    if (target) console.warn(`[db] copied to ${target} before upgrading past schema ${current}`)
  }

  const applied: number[] = []
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    })()
    applied.push(migration.version)
  }
  return applied
}

import type Database from 'better-sqlite3'
import * as m001 from './001_init'

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

/** Ordered. Append new migrations; never renumber or edit a shipped one. */
export const MIGRATIONS: readonly Migration[] = [m001]

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

/** Runs every migration newer than PRAGMA user_version. Returns the versions applied. */
export function runMigrations(db: Database.Database): number[] {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0)
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
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

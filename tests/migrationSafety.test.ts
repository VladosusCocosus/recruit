import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseCtor from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LATEST_VERSION, MIGRATIONS, backupPathFor, runMigrations } from '@main/db/migrations'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobbox-migrations-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A database file at `version`, with no tables — enough to exercise the runner's gates. */
function dbAtVersion(version: number): DatabaseCtor.Database {
  const db = new DatabaseCtor(join(dir, 'recruit.db'))
  db.pragma('journal_mode = WAL')
  db.pragma(`user_version = ${version}`)
  return db
}

describe('runMigrations', () => {
  it('refuses a database written by a newer build', () => {
    const db = dbAtVersion(LATEST_VERSION + 1)
    expect(() => runMigrations(db)).toThrow(/newer version/i)
    // The refusal must not have advanced or rewritten anything.
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION + 1)
    db.close()
  })

  it('is a no-op on a database already at the latest version', () => {
    const db = dbAtVersion(LATEST_VERSION)
    expect(runMigrations(db)).toEqual([])
    db.close()
  })

  it('copies the database before running a destructive migration', () => {
    const destructive = MIGRATIONS.filter((m) => m.destructive)
    expect(destructive.length).toBeGreaterThan(0)
    const first = destructive[0]!

    // One version short of the destructive migration, so it is in the pending set.
    const db = new DatabaseCtor(join(dir, 'recruit.db'))
    db.pragma('journal_mode = WAL')
    runMigrations(db)
    db.pragma(`user_version = ${first.version - 1}`)

    const backup = backupPathFor(db.name, first.version - 1)
    expect(existsSync(backup)).toBe(false)

    runMigrations(db)

    expect(existsSync(backup)).toBe(true)
    // The copy is a readable database still at the pre-migration version.
    const restored = new DatabaseCtor(backup, { readonly: true })
    expect(Number(restored.pragma('user_version', { simple: true }))).toBe(first.version - 1)
    restored.close()
    db.close()
  })

  it('takes no copy when nothing pending is destructive', () => {
    const db = new DatabaseCtor(join(dir, 'recruit.db'))
    db.pragma('journal_mode = WAL')
    runMigrations(db)

    const before = Number(db.pragma('user_version', { simple: true }))
    expect(runMigrations(db)).toEqual([])
    expect(existsSync(backupPathFor(db.name, before))).toBe(false)
    db.close()
  })

  it('runs every migration on an empty file and lands on the latest version', () => {
    const db = new DatabaseCtor(join(dir, 'recruit.db'))
    db.pragma('journal_mode = WAL')
    expect(runMigrations(db)).toEqual(MIGRATIONS.map((m) => m.version))
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION)
    db.close()
  })

  it('runs a destructive migration in memory, where there is nothing to copy', () => {
    const first = MIGRATIONS.find((m) => m.destructive)!
    const db = new DatabaseCtor(':memory:')
    db.pragma('foreign_keys = ON')

    // Build the real schema up to the version before the destructive one.
    for (const migration of MIGRATIONS.filter((m) => m.version < first.version)) {
      migration.up(db)
    }
    db.pragma(`user_version = ${first.version - 1}`)

    expect(() => runMigrations(db)).not.toThrow()
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION)
    db.close()
  })
})

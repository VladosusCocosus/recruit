/**
 * Migration 004 — resumes.
 *
 * A `resumes` library plus two columns on `items` recording which resume an application
 * was sent with. `resume_id` is a concrete FK rather than a "used the default" flag, so
 * changing the default later leaves past applications pointing at the file actually sent.
 *
 * The three resume states are read off the two columns:
 *   unanswered  resume_id IS NULL AND resume_skipped_at IS NULL
 *   answered    resume_id IS NOT NULL
 *   skipped     resume_skipped_at IS NOT NULL
 *
 * Additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 4
export const name = '004_resumes'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resumes (
      id          INTEGER PRIMARY KEY,
      label       TEXT NOT NULL,
      filename    TEXT NOT NULL,
      disk_path   TEXT NOT NULL,
      mime_type   TEXT,
      size        INTEGER NOT NULL,
      sha256      TEXT NOT NULL,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_sha ON resumes(sha256);

    -- Partial index: at most one row may carry is_default = 1.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_default
      ON resumes(is_default) WHERE is_default = 1;
  `)

  const columns = db.pragma('table_info(items)') as Array<{ name: string }>
  const has = (column: string): boolean => columns.some((c) => c.name === column)

  if (!has('resume_id')) {
    db.exec('ALTER TABLE items ADD COLUMN resume_id INTEGER REFERENCES resumes(id)')
  }
  if (!has('resume_skipped_at')) {
    db.exec('ALTER TABLE items ADD COLUMN resume_skipped_at TEXT')
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_items_resume ON items(resume_id)')
}

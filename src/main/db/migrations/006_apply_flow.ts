/**
 * Migration 006 — the apply flow.
 *
 * Adds `resume_masters`, the markdown resumes a tailor run works from, and the three
 * columns that tie a rendered application back to what produced it:
 *
 *   items.jd_md / jd_source / jd_updated_at
 *     the job description verbatim, a separate column set from description_md, which
 *     holds the enrich run's brief on the company
 *
 *   resumes.derived_from_master_id
 *     set on a file the apply flow rendered from a master, null on a user upload
 *
 * Additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 6
export const name = '006_apply_flow'

const ITEM_COLUMNS = ['jd_md', 'jd_source', 'jd_updated_at'] as const

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resume_masters (
      id          INTEGER PRIMARY KEY,
      label       TEXT NOT NULL,
      content_md  TEXT NOT NULL,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      archived_at TEXT
    );

    -- Partial index: at most one row may carry is_default = 1.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_masters_default
      ON resume_masters(is_default) WHERE is_default = 1;
  `)

  const itemColumns = new Set(
    (db.pragma('table_info(items)') as Array<{ name: string }>).map((c) => c.name)
  )
  for (const column of ITEM_COLUMNS) {
    if (!itemColumns.has(column)) {
      db.exec(`ALTER TABLE items ADD COLUMN ${column} TEXT`)
    }
  }

  const resumeColumns = new Set(
    (db.pragma('table_info(resumes)') as Array<{ name: string }>).map((c) => c.name)
  )
  if (!resumeColumns.has('derived_from_master_id')) {
    db.exec(
      'ALTER TABLE resumes ADD COLUMN derived_from_master_id INTEGER REFERENCES resume_masters(id)'
    )
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_resumes_master ON resumes(derived_from_master_id)')
}

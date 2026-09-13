/**
 * Migration 010 — a library that holds resumes holds a default.
 *
 * Migration 007 carried every file-library row across with `is_default = 0`, and its repair
 * clause only considered rows with markdown, so a library of file resumes came out of the
 * upgrade with no default at all. Which row the user had chosen is not recoverable — 007
 * did not carry the flag — so this picks the newest editable resume, the same rule 007 uses.
 *
 * Additive and idempotent: it does nothing when a default already exists.
 */
import type Database from 'better-sqlite3'

export const version = 10
export const name = '010_restore_resume_default'

export function up(db: Database.Database): void {
  const existing = db
    .prepare('SELECT count(*) AS n FROM resumes WHERE is_default = 1')
    .get() as { n: number }
  if (existing.n > 0) return

  db.exec(`
    UPDATE resumes SET is_default = 1
    WHERE id = (
      SELECT id FROM resumes
      WHERE archived_at IS NULL AND derived_from_id IS NULL AND content_md IS NOT NULL
      ORDER BY updated_at DESC, id DESC LIMIT 1
    );
  `)
}

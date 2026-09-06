/**
 * Migration 007 — one resume store, in markdown.
 *
 * `resumes` held files (hashed, copied to disk) and `resume_masters` held the markdown the
 * apply flow tailored. This collapses them into one table whose rows are markdown, and
 * drops the file columns.
 *
 * A row from the old file library survives with `content_md` NULL: a record that an
 * application was sent something, keeping `filename` and its id so `items.resume_id` still
 * resolves. The files under `userData/resumes` are left alone; nothing here touches disk.
 *
 * `items.resume_id` references `resumes`, so the links are read out, nulled, and written
 * back around the table swap — SQLite cannot drop a table while rows still point into it,
 * and `PRAGMA foreign_keys` is a no-op inside the transaction the runner wraps this in.
 */
import type Database from 'better-sqlite3'

export const version = 7
export const name = '007_markdown_resumes'

interface MasterRow {
  id: number
  label: string
  content_md: string
  is_default: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export function up(db: Database.Database): void {
  const columns = db.pragma('table_info(resumes)') as Array<{ name: string }>
  if (columns.some((c) => c.name === 'content_md')) return

  const links = db
    .prepare('SELECT id, resume_id FROM items WHERE resume_id IS NOT NULL')
    .all() as Array<{ id: number; resume_id: number }>
  db.exec('UPDATE items SET resume_id = NULL')

  db.exec(`
    CREATE TABLE resumes_new (
      id              INTEGER PRIMARY KEY,
      label           TEXT NOT NULL,
      content_md      TEXT,
      filename        TEXT,
      derived_from_id INTEGER REFERENCES resumes_new(id),
      is_default      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      archived_at     TEXT
    );
  `)

  db.exec(`
    INSERT INTO resumes_new
      (id, label, content_md, filename, derived_from_id, is_default, created_at, updated_at, archived_at)
    SELECT id, label, NULL, filename, NULL, 0, created_at, created_at, archived_at
    FROM resumes;
  `)

  const masters = db
    .prepare('SELECT * FROM resume_masters ORDER BY id')
    .all() as unknown as MasterRow[]

  const insertMaster = db.prepare(`
    INSERT INTO resumes_new
      (label, content_md, filename, derived_from_id, is_default, created_at, updated_at, archived_at)
    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
  `)
  const relink = db.prepare(`
    UPDATE resumes_new SET derived_from_id = ?
    WHERE id IN (SELECT id FROM resumes WHERE derived_from_master_id = ?)
  `)

  for (const master of masters) {
    const info = insertMaster.run(
      master.label,
      master.content_md,
      master.is_default,
      master.created_at,
      master.updated_at,
      master.archived_at
    )
    relink.run(Number(info.lastInsertRowid), master.id)
  }

  db.exec('DROP TABLE resumes')
  db.exec('DROP TABLE resume_masters')
  db.exec('ALTER TABLE resumes_new RENAME TO resumes')

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_default
      ON resumes(is_default) WHERE is_default = 1;
    CREATE INDEX IF NOT EXISTS idx_resumes_derived ON resumes(derived_from_id);
  `)

  const restore = db.prepare('UPDATE items SET resume_id = ? WHERE id = ?')
  for (const link of links) restore.run(link.resume_id, link.id)

  const hasDefault = db
    .prepare('SELECT count(*) AS n FROM resumes WHERE is_default = 1')
    .get() as { n: number }
  if (hasDefault.n === 0) {
    db.exec(`
      UPDATE resumes SET is_default = 1
      WHERE id = (
        SELECT id FROM resumes
        WHERE content_md IS NOT NULL AND archived_at IS NULL AND derived_from_id IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1
      );
    `)
  }
}

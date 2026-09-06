/**
 * Migration 008 — the documents an application was sent, and the questions its form asked.
 *
 * `resumes.pdf_path` and `items.cover_letter_pdf_path` point at renders kept under
 * `userData/documents`. Markdown stays the editable source; the PDF is the frozen copy
 * that was actually sent, so editing a resume later does not rewrite history.
 *
 * `item_answers` holds one row per question an application form asked, with whatever has
 * been written back. `answer_md` is nullable: a question can be recorded before it has an
 * answer.
 *
 * Purely additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 8
export const name = '008_documents_and_answers'

function addColumn(db: Database.Database, table: string, column: string, type: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function up(db: Database.Database): void {
  addColumn(db, 'resumes', 'pdf_path', 'TEXT')
  addColumn(db, 'items', 'cover_letter_md', 'TEXT')
  addColumn(db, 'items', 'cover_letter_pdf_path', 'TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS item_answers (
      id         INTEGER PRIMARY KEY,
      item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      question   TEXT NOT NULL,
      answer_md  TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_item_answers_item ON item_answers(item_id, id);
  `)
}

/**
 * Migration 009 — per-folder IMAP cursors.
 *
 * Sync walks every folder on the account, so "where did the last pass stop" is a fact about
 * (account, folder) rather than about the account. accounts.last_uid_validity and
 * accounts.last_uid are superseded: the INBOX cursor is copied across here and the two
 * columns are left in place, unread, because dropping a column rewrites the table.
 *
 * Purely additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 9
export const name = '009_folder_cursors'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folder_cursors (
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder       TEXT NOT NULL,
  uid_validity INTEGER NOT NULL,
  last_uid     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, folder)
);
`

export function up(db: Database.Database): void {
  db.exec(SCHEMA)
  db.prepare(
    `INSERT OR IGNORE INTO folder_cursors (account_id, folder, uid_validity, last_uid, updated_at)
     SELECT id, 'INBOX', last_uid_validity, COALESCE(last_uid, 0), created_at
       FROM accounts
      WHERE last_uid_validity IS NOT NULL`
  ).run()
}

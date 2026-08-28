/**
 * Migration 003 — local delete.
 *
 * Deleting is LOCAL and SOFT. v1 mail is read-only over IMAP, so a real delete is not ours to
 * make; and dropping the row would orphan item_messages, agent_run_messages and any proposal
 * that names the message, then hand it all back on the next sync. deleted_at is the answer:
 * one nullable timestamp that every read path filters on, and that undelete clears.
 *
 * Purely additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 3
export const name = '003_message_deleted_at'

export function up(db: Database.Database): void {
  const columns = db.pragma('table_info(messages)') as Array<{ name: string }>
  if (columns.some((column) => column.name === 'deleted_at')) return
  db.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT')
}

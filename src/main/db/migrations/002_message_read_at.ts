/**
 * Migration 002 — local read state.
 *
 * v1 mail is read-only over IMAP, so opening a message can never write \Seen back to the
 * server; every row would stay unread forever. read_at is this app's own answer: a nullable
 * timestamp that, together with the missing \Seen flag, is what "unread" now means.
 *
 * Purely additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 2
export const name = '002_message_read_at'

export function up(db: Database.Database): void {
  const columns = db.pragma('table_info(messages)') as Array<{ name: string }>
  if (columns.some((column) => column.name === 'read_at')) return
  db.exec('ALTER TABLE messages ADD COLUMN read_at TEXT')
}

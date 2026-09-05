/**
 * Migration 005 — call debriefs.
 *
 * Adds five nullable columns to timeline_events: `call_type` and `call_with` describe a
 * meeting logged as a call, and `outcome` / `debriefed_at` / `snooze_until` hold that
 * call's debrief state. A row with a null `call_type` is not a call and is never
 * prompted for a debrief.
 *
 * Purely additive, and guarded so re-running it over a populated recruit.db is a no-op.
 */
import type Database from 'better-sqlite3'

export const version = 5
export const name = '005_call_debrief'

const COLUMNS = [
  'call_type',
  'call_with',
  'outcome',
  'debriefed_at',
  'snooze_until'
] as const

export function up(db: Database.Database): void {
  const existing = new Set(
    (db.pragma('table_info(timeline_events)') as Array<{ name: string }>).map((c) => c.name)
  )
  for (const column of COLUMNS) {
    if (!existing.has(column)) {
      db.exec(`ALTER TABLE timeline_events ADD COLUMN ${column} TEXT`)
    }
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_timeline_debrief
       ON timeline_events(call_type, debriefed_at, ends_at)`
  )
}

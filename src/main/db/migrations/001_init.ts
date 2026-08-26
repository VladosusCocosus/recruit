/**
 * Migration 001 — the whole schema. Table and column names are verbatim from the brief;
 * do not "improve" them, the MCP tool layer and the repos both depend on them.
 */
import type Database from 'better-sqlite3'
import { STATUS_SEED } from '@shared/types'

export const version = 1
export const name = '001_init'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id                 INTEGER PRIMARY KEY,
  email              TEXT NOT NULL,
  display_name       TEXT,
  imap_host          TEXT NOT NULL,
  imap_port          INTEGER NOT NULL,
  imap_secure        INTEGER NOT NULL DEFAULT 1,
  imap_user          TEXT NOT NULL,
  smtp_host          TEXT,
  smtp_port          INTEGER,
  smtp_secure        INTEGER,
  smtp_user          TEXT,
  keychain_ref_imap  TEXT,
  keychain_ref_smtp  TEXT,
  last_uid_validity  INTEGER,
  last_uid           INTEGER,
  created_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

CREATE TABLE IF NOT EXISTS messages (
  id                     INTEGER PRIMARY KEY,
  account_id             INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder                 TEXT NOT NULL,
  uid                    INTEGER NOT NULL,
  uid_validity           INTEGER NOT NULL,
  message_id             TEXT,
  in_reply_to            TEXT,
  references_json        TEXT,
  thread_key             TEXT,
  from_name              TEXT,
  from_addr              TEXT,
  from_domain            TEXT,
  to_json                TEXT,
  cc_json                TEXT,
  subject                TEXT,
  date_utc               TEXT,
  snippet                TEXT,
  body_text              TEXT,
  body_html              TEXT,
  list_unsubscribe       TEXT,
  has_attachments        INTEGER NOT NULL DEFAULT 0,
  flags_json             TEXT,
  prefilter_score        REAL,
  prefilter_reasons_json TEXT,
  triage_state           TEXT NOT NULL DEFAULT 'unseen',
  fetched_at             TEXT NOT NULL,
  UNIQUE(account_id, folder, uid_validity, uid)
);
CREATE INDEX IF NOT EXISTS idx_messages_thread_key   ON messages(thread_key);
CREATE INDEX IF NOT EXISTS idx_messages_from_domain  ON messages(from_domain);
CREATE INDEX IF NOT EXISTS idx_messages_triage_state ON messages(triage_state);
CREATE INDEX IF NOT EXISTS idx_messages_message_id   ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_list         ON messages(account_id, folder, date_utc DESC);
CREATE INDEX IF NOT EXISTS idx_messages_score        ON messages(prefilter_score DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename    TEXT,
  mime_type   TEXT,
  size        INTEGER,
  content_id  TEXT,
  disk_path   TEXT,
  is_calendar INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

CREATE TABLE IF NOT EXISTS statuses (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  color      TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id                      INTEGER PRIMARY KEY,
  company                 TEXT NOT NULL,
  company_domain          TEXT,
  role                    TEXT,
  location                TEXT,
  work_mode               TEXT,
  source                  TEXT,
  job_url                 TEXT,
  compensation_note       TEXT,
  status_id               INTEGER NOT NULL REFERENCES statuses(id),
  close_reason            TEXT,
  description_md          TEXT,
  description_source      TEXT,
  description_updated_at  TEXT,
  contact_name            TEXT,
  contact_email           TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  archived_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_status   ON items(status_id);
CREATE INDEX IF NOT EXISTS idx_items_domain   ON items(company_domain);
CREATE INDEX IF NOT EXISTS idx_items_archived ON items(archived_at);
CREATE INDEX IF NOT EXISTS idx_items_company  ON items(company);

CREATE TABLE IF NOT EXISTS item_messages (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY(item_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_item_messages_message ON item_messages(message_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body_md       TEXT,
  occurred_at   TEXT,
  starts_at     TEXT,
  ends_at       TEXT,
  tz            TEXT,
  location      TEXT,
  meeting_url   TEXT,
  message_id    INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  ics_uid       TEXT,
  ics_sequence  INTEGER,
  source        TEXT NOT NULL DEFAULT 'user',
  superseded_by INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_item      ON timeline_events(item_id);
CREATE INDEX IF NOT EXISTS idx_timeline_starts_at ON timeline_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_timeline_ics_uid   ON timeline_events(ics_uid);
CREATE INDEX IF NOT EXISTS idx_timeline_message   ON timeline_events(message_id);
CREATE INDEX IF NOT EXISTS idx_timeline_live      ON timeline_events(item_id, superseded_by);

CREATE TABLE IF NOT EXISTS agent_runs (
  id                INTEGER PRIMARY KEY,
  kind              TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  command_json      TEXT,
  model             TEXT,
  session_id        TEXT,
  exit_code         INTEGER,
  is_error          INTEGER NOT NULL DEFAULT 0,
  error_text        TEXT,
  duration_ms       INTEGER,
  cost_usd          REAL,
  raw_envelope_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_messages (
  run_id     INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY(run_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_run_messages_message ON agent_run_messages(message_id);

CREATE TABLE IF NOT EXISTS proposals (
  id              INTEGER PRIMARY KEY,
  run_id          INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  ref             TEXT,
  target_item_id  INTEGER REFERENCES items(id) ON DELETE CASCADE,
  target_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL,
  payload_json    TEXT,
  confidence      REAL,
  rationale       TEXT,
  state           TEXT NOT NULL DEFAULT 'pending',
  decided_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_state  ON proposals(state);
CREATE INDEX IF NOT EXISTS idx_proposals_run    ON proposals(run_id);
CREATE INDEX IF NOT EXISTS idx_proposals_ref    ON proposals(run_id, ref);
CREATE INDEX IF NOT EXISTS idx_proposals_target ON proposals(target_item_id);

-- Not in the authoritative schema: a tiny key/value bag so AppSettings (and any other
-- small singleton) has one durable home inside the single DB writer instead of a
-- second, competing persistence mechanism. Nothing else depends on it.
CREATE TABLE IF NOT EXISTS app_kv (
  key        TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at TEXT NOT NULL
);
`

export function up(db: Database.Database): void {
  db.exec(SCHEMA)

  const insertStatus = db.prepare<
    [string, string, string, number, string | null]
  >(
    `INSERT INTO statuses (key, label, kind, sort_order, color)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       label = excluded.label, kind = excluded.kind, sort_order = excluded.sort_order`
  )
  for (const s of STATUS_SEED) {
    insertStatus.run(s.key, s.label, s.kind, s.sortOrder, s.color)
  }
}

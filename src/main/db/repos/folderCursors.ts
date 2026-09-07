/**
 * Where the last IMAP pass stopped, per (account, folder). One row per folder the sync has
 * opened; a folder with no row has never been synced and gets the backfill window.
 */
import type { FolderCursor } from '@shared/types'
import { execute, queryAll } from '../connection'
import { nowIso } from '../rows'

interface FolderCursorRow {
  folder: string
  uid_validity: number
  last_uid: number
}

export function listFolderCursors(accountId: number): FolderCursor[] {
  return queryAll<FolderCursorRow>(
    'SELECT folder, uid_validity, last_uid FROM folder_cursors WHERE account_id = ?',
    accountId
  ).map((row) => ({
    folder: row.folder,
    uidValidity: row.uid_validity,
    lastUid: row.last_uid
  }))
}

export function setFolderCursor(
  accountId: number,
  folder: string,
  uidValidity: number,
  lastUid: number
): void {
  execute(
    `INSERT INTO folder_cursors (account_id, folder, uid_validity, last_uid, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, folder) DO UPDATE SET
       uid_validity = excluded.uid_validity,
       last_uid = excluded.last_uid,
       updated_at = excluded.updated_at`,
    accountId,
    folder,
    uidValidity,
    lastUid,
    nowIso()
  )
}

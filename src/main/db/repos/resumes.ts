/**
 * The resume library. Rows only — the files themselves are owned by @main/resumes, which
 * is the one module that touches the resumes directory.
 *
 * `disk_path` never leaves this layer as part of a `Resume`; `resumePath()` is the single
 * accessor, and it takes an id.
 */
import type { Resume } from '@shared/types'
import { count, execute, queryAll, queryOne, transact } from '../connection'
import { nowIso } from '../rows'

export interface ResumeRow {
  id: number
  label: string
  filename: string
  disk_path: string
  mime_type: string | null
  size: number
  sha256: string
  is_default: number
  created_at: string
  archived_at: string | null
  usage_count: number
}

export interface ResumeFileInput {
  label: string
  filename: string
  diskPath: string
  mimeType: string | null
  size: number
  sha256: string
}

function rowToResume(row: ResumeRow): Resume {
  return {
    id: row.id,
    label: row.label,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    usageCount: row.usage_count ?? 0
  }
}

const COLUMNS = `r.*, (SELECT count(*) FROM items i WHERE i.resume_id = r.id) AS usage_count`

/** Live resumes, default first, then newest. */
export function listResumes(includeArchived = false): Resume[] {
  const where = includeArchived ? '' : 'WHERE r.archived_at IS NULL'
  return queryAll<ResumeRow>(
    `SELECT ${COLUMNS} FROM resumes r ${where} ORDER BY r.is_default DESC, r.created_at DESC, r.id DESC`
  ).map(rowToResume)
}

export function getResume(resumeId: number): Resume | null {
  const row = queryOne<ResumeRow>(`SELECT ${COLUMNS} FROM resumes r WHERE r.id = ?`, resumeId)
  return row ? rowToResume(row) : null
}

export function getDefaultResume(): Resume | null {
  const row = queryOne<ResumeRow>(
    `SELECT ${COLUMNS} FROM resumes r WHERE r.is_default = 1 AND r.archived_at IS NULL`
  )
  return row ? rowToResume(row) : null
}

/** Absolute path of a stored resume, or null. The only way out of the row layer. */
export function resumePath(resumeId: number): string | null {
  const row = queryOne<{ disk_path: string }>('SELECT disk_path FROM resumes WHERE id = ?', resumeId)
  return row?.disk_path ?? null
}

export function findResumeBySha(sha256: string): Resume | null {
  const row = queryOne<ResumeRow>(`SELECT ${COLUMNS} FROM resumes r WHERE r.sha256 = ?`, sha256)
  return row ? rowToResume(row) : null
}

/**
 * Inserts a resume row. A row with the same sha256 is reused and un-archived instead,
 * so re-uploading a file already in the library does not duplicate it.
 */
export function createResume(input: ResumeFileInput, makeDefault = false): Resume {
  return transact(() => {
    const existing = findResumeBySha(input.sha256)
    let id: number
    if (existing) {
      execute('UPDATE resumes SET archived_at = NULL WHERE id = ?', existing.id)
      id = existing.id
    } else {
      const info = execute(
        `INSERT INTO resumes (label, filename, disk_path, mime_type, size, sha256, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        input.label,
        input.filename,
        input.diskPath,
        input.mimeType,
        input.size,
        input.sha256,
        nowIso()
      )
      id = Number(info.lastInsertRowid)
    }

    if (makeDefault) markDefault(id)
    const resume = getResume(id)
    if (!resume) throw new Error(`Resume ${id} disappeared after insert`)
    return resume
  })
}

/** Clears the flag everywhere, then sets it on `resumeId`. */
export function markDefault(resumeId: number): void {
  transact(() => {
    execute('UPDATE resumes SET is_default = 0 WHERE is_default = 1')
    execute('UPDATE resumes SET is_default = 1, archived_at = NULL WHERE id = ?', resumeId)
  })
}

export function renameResume(resumeId: number, label: string): void {
  const trimmed = label.trim()
  if (!trimmed) throw new Error('A resume needs a name')
  execute('UPDATE resumes SET label = ? WHERE id = ?', trimmed, resumeId)
}

/**
 * Soft delete. The row and the file both stay: items already pointing at this resume are a
 * record of what was actually sent.
 */
export function archiveResume(resumeId: number): void {
  execute('UPDATE resumes SET archived_at = ?, is_default = 0 WHERE id = ?', nowIso(), resumeId)
}

export function countResumes(): number {
  return count('SELECT count(*) FROM resumes WHERE archived_at IS NULL')
}

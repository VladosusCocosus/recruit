/**
 * The resume masters: resumes held as markdown, edited in place, and tailored from.
 *
 * Distinct from `resumes`, which stores the files that were SENT — keyed by content hash
 * and never rewritten. A file the apply flow rendered carries `derivedFromMasterId`.
 */
import type { ResumeMaster, ResumeMasterInput } from '@shared/types'
import { count, execute, queryAll, queryOne, transact } from '../connection'
import { nowIso } from '../rows'

export interface ResumeMasterRow {
  id: number
  label: string
  content_md: string
  is_default: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

function rowToResumeMaster(row: ResumeMasterRow): ResumeMaster {
  return {
    id: row.id,
    label: row.label,
    contentMd: row.content_md,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  }
}

/** Live masters, default first, then most recently edited. */
export function listResumeMasters(includeArchived = false): ResumeMaster[] {
  const where = includeArchived ? '' : 'WHERE archived_at IS NULL'
  return queryAll<ResumeMasterRow>(
    `SELECT * FROM resume_masters ${where} ORDER BY is_default DESC, updated_at DESC, id DESC`
  ).map(rowToResumeMaster)
}

export function getResumeMaster(masterId: number): ResumeMaster | null {
  const row = queryOne<ResumeMasterRow>('SELECT * FROM resume_masters WHERE id = ?', masterId)
  return row ? rowToResumeMaster(row) : null
}

export function getDefaultResumeMaster(): ResumeMaster | null {
  const row = queryOne<ResumeMasterRow>(
    'SELECT * FROM resume_masters WHERE is_default = 1 AND archived_at IS NULL'
  )
  return row ? rowToResumeMaster(row) : null
}

export function countResumeMasters(): number {
  return count('SELECT count(*) FROM resume_masters WHERE archived_at IS NULL')
}

/** Inserts a master. The first live one is the default whatever `makeDefault` says. */
export function createResumeMaster(input: ResumeMasterInput, makeDefault = false): ResumeMaster {
  return transact(() => {
    const first = countResumeMasters() === 0
    const now = nowIso()
    const info = execute(
      `INSERT INTO resume_masters (label, content_md, is_default, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?)`,
      input.label,
      input.contentMd,
      now,
      now
    )
    const id = Number(info.lastInsertRowid)

    if (makeDefault || first) markDefaultResumeMaster(id)
    const master = getResumeMaster(id)
    if (!master) throw new Error(`Resume master ${id} disappeared after insert`)
    return master
  })
}

/** Undefined fields are untouched. Any call stamps updated_at. */
export function updateResumeMaster(
  masterId: number,
  patch: Partial<ResumeMasterInput>
): ResumeMaster {
  const sets: string[] = []
  const params: unknown[] = []
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.label !== undefined) put('label', patch.label)
  if (patch.contentMd !== undefined) put('content_md', patch.contentMd)

  put('updated_at', nowIso())
  params.push(masterId)
  execute(`UPDATE resume_masters SET ${sets.join(', ')} WHERE id = ?`, ...params)

  const master = getResumeMaster(masterId)
  if (!master) throw new Error(`Resume master ${masterId} not found`)
  return master
}

/** Clears the flag everywhere, then sets it on `masterId`. */
export function markDefaultResumeMaster(masterId: number): void {
  transact(() => {
    execute('UPDATE resume_masters SET is_default = 0 WHERE is_default = 1')
    execute('UPDATE resume_masters SET is_default = 1, archived_at = NULL WHERE id = ?', masterId)
  })
}

/**
 * Soft delete. The row stays: resumes rendered from this master keep pointing at it.
 */
export function archiveResumeMaster(masterId: number): void {
  execute(
    'UPDATE resume_masters SET archived_at = ?, is_default = 0 WHERE id = ?',
    nowIso(),
    masterId
  )
}

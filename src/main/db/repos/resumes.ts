/**
 * The resume library: markdown documents, rendered to PDF on demand by @main/render.
 *
 * A row whose `content_md` is null came from the file library that predated markdown
 * resumes. It is a record that an application was sent something, and nothing more —
 * it cannot be edited, tailored or rendered.
 *
 * `pdf_path` never leaves this layer as part of a `Resume`; `resumePdfPath()` is the single
 * accessor, and it takes an id.
 */
import type { Resume, ResumeInput } from '@shared/types'
import { count, execute, queryAll, queryOne, transact } from '../connection'
import { nowIso } from '../rows'

export interface ResumeRow {
  id: number
  label: string
  content_md: string | null
  filename: string | null
  pdf_path: string | null
  derived_from_id: number | null
  is_default: number
  created_at: string
  updated_at: string
  archived_at: string | null
  usage_count: number
}

/** What `createResume` needs. A tailored resume names the one it was built from. */
export interface CreateResumeInput extends ResumeInput {
  derivedFromId?: number | null
}

function rowToResume(row: ResumeRow): Resume {
  return {
    id: row.id,
    label: row.label,
    contentMd: row.content_md,
    derivedFromId: row.derived_from_id,
    isDefault: row.is_default === 1,
    usageCount: row.usage_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    filename: row.filename,
    hasPdf: row.pdf_path !== null
  }
}

const COLUMNS = `r.*, (SELECT count(*) FROM items i WHERE i.resume_id = r.id) AS usage_count`

/**
 * The library, default first then newest. Tailored resumes are excluded;
 * `listResumeVariants` returns those.
 */
export function listResumes(includeArchived = false): Resume[] {
  const clauses = ['r.derived_from_id IS NULL']
  if (!includeArchived) clauses.push('r.archived_at IS NULL')
  const rows = queryAll<ResumeRow>(
    `SELECT ${COLUMNS} FROM resumes r WHERE ${clauses.join(' AND ')}
     ORDER BY r.is_default DESC, r.updated_at DESC, r.id DESC`
  )
  return rows.map(rowToResume)
}

/** Every resume the apply flow tailored, newest first. */
export function listResumeVariants(derivedFromId?: number): Resume[] {
  const rows =
    derivedFromId === undefined
      ? queryAll<ResumeRow>(
          `SELECT ${COLUMNS} FROM resumes r WHERE r.derived_from_id IS NOT NULL
           ORDER BY r.created_at DESC, r.id DESC`
        )
      : queryAll<ResumeRow>(
          `SELECT ${COLUMNS} FROM resumes r WHERE r.derived_from_id = ?
           ORDER BY r.created_at DESC, r.id DESC`,
          derivedFromId
        )
  return rows.map(rowToResume)
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

/** Absolute path of the rendered PDF, or null. The only way out of the row layer. */
export function resumePdfPath(resumeId: number): string | null {
  const row = queryOne<{ pdf_path: string | null }>(
    'SELECT pdf_path FROM resumes WHERE id = ?',
    resumeId
  )
  return row?.pdf_path ?? null
}

/** Live, editable resumes — everything the apply flow can start from. */
export function countResumes(): number {
  return count(
    `SELECT count(*) FROM resumes
     WHERE archived_at IS NULL AND derived_from_id IS NULL AND content_md IS NOT NULL`
  )
}

/**
 * Records a resume. The first live one becomes the default whatever `makeDefault` says,
 * so a library with resumes in it always has one.
 */
export function createResume(input: CreateResumeInput, makeDefault = false): Resume {
  return transact(() => {
    const label = input.label.trim()
    if (!label) throw new Error('A resume needs a name.')

    const now = nowIso()
    const derivedFromId = input.derivedFromId ?? null
    const id = execute(
      `INSERT INTO resumes (label, content_md, filename, derived_from_id, is_default,
                            created_at, updated_at)
       VALUES (?, ?, NULL, ?, 0, ?, ?)`,
      label,
      input.contentMd,
      derivedFromId,
      now,
      now
    ).lastInsertRowid as number

    const first = derivedFromId === null && countResumes() === 1
    if (makeDefault || first) markDefault(id)

    const created = getResume(id)
    if (!created) throw new Error(`Resume ${id} not found`)
    return created
  })
}

/** Undefined fields are untouched. A resume with no markdown cannot be edited. */
export function updateResume(resumeId: number, patch: Partial<ResumeInput>): Resume {
  const existing = getResume(resumeId)
  if (!existing) throw new Error(`Resume ${resumeId} not found`)
  if (existing.contentMd === null) {
    throw new Error('That resume is a record of a file that is no longer stored.')
  }

  const sets: string[] = []
  const params: unknown[] = []
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.label !== undefined) {
    const label = patch.label.trim()
    if (!label) throw new Error('A resume needs a name.')
    put('label', label)
  }
  if (patch.contentMd !== undefined) put('content_md', patch.contentMd)

  if (sets.length > 0) {
    put('updated_at', nowIso())
    params.push(resumeId)
    execute(`UPDATE resumes SET ${sets.join(', ')} WHERE id = ?`, ...params)
  }

  const updated = getResume(resumeId)
  if (!updated) throw new Error(`Resume ${resumeId} not found`)
  return updated
}

/** Records the render @main/render produced, or forgets it with null. */
export function setResumePdf(resumeId: number, pdfPath: string | null): void {
  execute('UPDATE resumes SET pdf_path = ? WHERE id = ?', pdfPath, resumeId)
}

/** Clears the flag everywhere, then sets it here. Un-archives, so the default is live. */
export function markDefault(resumeId: number): void {
  transact(() => {
    execute('UPDATE resumes SET is_default = 0 WHERE is_default = 1')
    execute('UPDATE resumes SET is_default = 1, archived_at = NULL WHERE id = ?', resumeId)
  })
}

/** Soft: applications pointing at it keep the record. */
export function archiveResume(resumeId: number): void {
  execute(
    'UPDATE resumes SET archived_at = ?, is_default = 0, updated_at = ? WHERE id = ?',
    nowIso(),
    nowIso(),
    resumeId
  )
}

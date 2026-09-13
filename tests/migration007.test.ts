import DatabaseCtor from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '@main/db/migrations'

const M007 = MIGRATIONS.find((m) => m.version === 7)!
const M010 = MIGRATIONS.find((m) => m.version === 10)!

let db: DatabaseCtor.Database

/** A database at schema 6: the shape 0.2.0 left behind, before markdown resumes. */
beforeEach(() => {
  db = new DatabaseCtor(':memory:')
  db.pragma('foreign_keys = ON')
  for (const migration of MIGRATIONS.filter((m) => m.version < 7)) migration.up(db)
  db.pragma('user_version = 6')
})

function addFileResume(label: string, isDefault: boolean, sha: string): number {
  const info = db
    .prepare(
      `INSERT INTO resumes (label, filename, disk_path, mime_type, size, sha256, is_default, created_at)
       VALUES (?, ?, ?, 'application/pdf', 1024, ?, ?, '2026-08-01T10:00:00.000Z')`
    )
    .run(label, `${label}.pdf`, `/tmp/resumes/${sha}.pdf`, sha, isDefault ? 1 : 0)
  return Number(info.lastInsertRowid)
}

function addItem(company: string, resumeId: number | null): number {
  const status = db.prepare("SELECT id FROM statuses WHERE key = 'applied'").get() as { id: number }
  const info = db
    .prepare(
      `INSERT INTO items (company, status_id, resume_id, created_at, updated_at)
       VALUES (?, ?, ?, '2026-08-02T10:00:00.000Z', '2026-08-02T10:00:00.000Z')`
    )
    .run(company, status.id, resumeId)
  return Number(info.lastInsertRowid)
}

function defaults(): number {
  const row = db.prepare('SELECT count(*) AS n FROM resumes WHERE is_default = 1').get() as {
    n: number
  }
  return row.n
}

describe('migration 007, upgrading a file-library database', () => {
  it('does not carry the chosen default across, which 010 then repairs', () => {
    addFileResume('Backend CV', true, 'aaa111')
    addFileResume('Frontend CV', false, 'bbb222')

    M007.up(db)

    // 007 selects a literal 0 into is_default and its repair clause only considers rows
    // holding markdown, so a file-only library lands with none. Which row the user chose
    // is gone with the flag; 010 restores the invariant, not the choice.
    expect(defaults()).toBe(0)

    M010.up(db)
    db.prepare("UPDATE resumes SET content_md = '## Skills' WHERE label = 'Frontend CV'").run()
    M010.up(db)
    expect(defaults()).toBe(1)
  })

  it('leaves every application pointing at the resume it was sent with', () => {
    const backend = addFileResume('Backend CV', true, 'aaa111')
    const frontend = addFileResume('Frontend CV', false, 'bbb222')
    const one = addItem('Northwind', backend)
    const two = addItem('Contoso', frontend)

    M007.up(db)

    const link = (id: number): number | null =>
      (db.prepare('SELECT resume_id FROM items WHERE id = ?').get(id) as { resume_id: number | null })
        .resume_id
    expect(link(one)).toBe(backend)
    expect(link(two)).toBe(frontend)
  })

  it('carries the label and filename of a resume it can no longer render', () => {
    addFileResume('Backend CV', true, 'aaa111')

    M007.up(db)

    const row = db.prepare('SELECT label, filename, content_md FROM resumes').get() as {
      label: string
      filename: string | null
      content_md: string | null
    }
    expect(row.label).toBe('Backend CV')
    expect(row.filename).toBe('Backend CV.pdf')
    expect(row.content_md).toBeNull()
  })

  it('leaves no dangling resume reference behind', () => {
    const backend = addFileResume('Backend CV', true, 'aaa111')
    addItem('Northwind', backend)

    M007.up(db)

    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('promotes a markdown master when the library had no default at all', () => {
    addFileResume('Backend CV', false, 'aaa111')
    db.prepare(
      `INSERT INTO resume_masters (label, content_md, is_default, created_at, updated_at)
       VALUES ('Master', '## Skills', 0, '2026-08-03T10:00:00.000Z', '2026-08-03T10:00:00.000Z')`
    ).run()

    M007.up(db)

    expect(defaults()).toBe(1)
  })
})

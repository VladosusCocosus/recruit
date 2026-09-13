import { beforeEach, describe, expect, it } from 'vitest'
import {
  count,
  createResume,
  execute,
  fileApplication,
  getItemSummary,
  listItems,
  openDatabase,
  type FileApplicationInput
} from '@main/db'

let masterId: number

beforeEach(() => {
  openDatabase({ path: ':memory:', reopen: true })
  masterId = createResume({ label: 'Backend CV', contentMd: '## Skills\n\nGo, SQL\n' }).id
})

function draft(overrides: Partial<FileApplicationInput> = {}): FileApplicationInput {
  return {
    company: 'Northwind',
    role: 'Staff Engineer',
    location: null,
    workMode: null,
    jobUrl: null,
    jdMd: 'We need a staff engineer.',
    jdSource: 'pasted',
    resumeLabel: 'Backend CV — Northwind',
    resumeMd: '## Skills\n\nGo, SQL, Kubernetes\n',
    derivedFromId: masterId,
    resumePdfPath: '/tmp/jobbox-test/resume.pdf',
    coverLetterMd: null,
    coverLetterPdfPath: null,
    questions: [],
    ...overrides
  }
}

/** Every resume row. `listResumes` filters derived rows out, so it cannot see a variant. */
function countAllResumes(): number {
  return count('SELECT count(*) FROM resumes')
}

function countVariants(): number {
  return count('SELECT count(*) FROM resumes WHERE derived_from_id IS NOT NULL')
}

describe('fileApplication', () => {
  it('files the application with its resume attached', () => {
    const item = fileApplication(draft())

    expect(item.company).toBe('Northwind')
    expect(item.statusKey).toBe('applied')
    expect(item.resumeId).not.toBeNull()
    // The tailored variant resolves on the board row, not just as an id.
    expect(getItemSummary(item.id)?.resume?.label).toBe('Backend CV — Northwind')
  })

  it('keeps the cover letter and the answers the form asked for', () => {
    const item = fileApplication(
      draft({
        coverLetterMd: 'Dear hiring manager,',
        coverLetterPdfPath: '/tmp/jobbox-test/letter.pdf',
        questions: [
          { question: 'Why us?', answerMd: 'Because of the work.' },
          { question: '   ', answerMd: 'dropped' }
        ]
      })
    )

    expect(item.coverLetterMd).toBe('Dear hiring manager,')
    expect(item.hasCoverLetterPdf).toBe(true)
  })

  it('writes nothing at all when the status it files under is missing', () => {
    const resumesBefore = countAllResumes()
    const itemsBefore = listItems().length

    // The failure the eight-write sequence was exposed to: createItem throws part-way.
    execute("DELETE FROM statuses WHERE key = 'applied'")

    expect(() => fileApplication(draft())).toThrow()
    expect(countAllResumes()).toBe(resumesBefore)
    expect(listItems()).toHaveLength(itemsBefore)
  })

  it('leaves no orphan resume behind when a later write fails', () => {
    execute("DELETE FROM statuses WHERE key = 'applied'")
    try {
      fileApplication(draft())
    } catch {
      /* expected */
    }

    // The tailored variant is the row a non-transactional sequence would strand.
    expect(countVariants()).toBe(0)
  })

  it('does not partially file the answers when one of them fails', () => {
    const itemsBefore = listItems().length
    expect(() =>
      fileApplication(
        draft({
          // A question row that violates NOT NULL on `question`.
          questions: [{ question: 'Why us?', answerMd: 'ok' }, { question: null as never, answerMd: 'x' }]
        })
      )
    ).toThrow()
    expect(listItems()).toHaveLength(itemsBefore)
  })
})

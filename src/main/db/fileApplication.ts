/**
 * Filing one application: the resume it was tailored into, the tracker row, the cover
 * letter and the form answers, as a single transaction.
 *
 * The rendered PDFs are written to disk by the caller and named here only by path, so this
 * module stays a pure database operation.
 */
import type { Item, JobDescriptionSource, WorkMode } from '@shared/types'
import { transact } from './connection'
import { saveItemAnswer } from './repos/answers'
import { createItem, setItemCoverLetter, setItemResume } from './repos/items'
import { createResume, setResumePdf } from './repos/resumes'

export interface FileApplicationInput {
  company: string
  role: string | null
  location: string | null
  workMode: WorkMode | null
  jobUrl: string | null
  jdMd: string
  jdSource: JobDescriptionSource
  /** Name for the tailored resume, and the id of the master it came from. */
  resumeLabel: string
  resumeMd: string
  derivedFromId: number
  resumePdfPath: string
  coverLetterMd: string | null
  coverLetterPdfPath: string | null
  questions: readonly { question: string; answerMd: string | null }[]
}

/** The filed application, at `applied`, with the resume and cover letter attached. */
export function fileApplication(input: FileApplicationInput): Item {
  return transact(() => {
    const resume = createResume({
      label: input.resumeLabel,
      contentMd: input.resumeMd,
      derivedFromId: input.derivedFromId
    })
    setResumePdf(resume.id, input.resumePdfPath)

    const created = createItem({
      company: input.company,
      role: input.role,
      location: input.location,
      workMode: input.workMode,
      jobUrl: input.jobUrl,
      jdMd: input.jdMd,
      jdSource: input.jdSource,
      source: 'apply',
      statusKey: 'applied'
    })
    setItemResume(created.id, resume.id)
    const item = setItemCoverLetter(created.id, input.coverLetterMd, input.coverLetterPdfPath)

    for (const entry of input.questions) {
      if (!entry.question.trim()) continue
      saveItemAnswer({ itemId: item.id, question: entry.question, answerMd: entry.answerMd })
    }

    return item
  })
}

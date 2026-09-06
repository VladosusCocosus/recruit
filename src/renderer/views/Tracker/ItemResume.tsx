/**
 * The resume section of the item inspector: which resume this application was sent with.
 *
 * Mounts its own copy of the picker menu, so the inspector answers the question without
 * going back to the board. Renders nothing at all for an application that has not reached
 * Applied — there is no resume to have sent yet.
 *
 * The file itself is <ItemDocuments>, below: this section names the resume, that one hands
 * it over.
 */

import { useRef, useState, type JSX } from 'react'
import { isEditableResume, type ItemSummary, type Status } from '@shared/types'
import { Icon } from '@renderer/components'
import { isAppliedOrLater, resumeAnswer } from '@shared/resume'
import { ResumeMenu, resumeMenuTargetFromElement, type ResumeMenuTarget } from './ResumeMenu'
import { useResumePicker } from './useResumePicker'

export function ItemResume({
  item,
  statuses,
  onOpenResumeSettings
}: {
  item: ItemSummary
  statuses: readonly Status[]
  onOpenResumeSettings: () => void
}): JSX.Element | null {
  const picker = useResumePicker(onOpenResumeSettings)
  const [menu, setMenu] = useState<ResumeMenuTarget | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)

  if (!isAppliedOrLater(item.statusKey, statuses)) return null

  const answer = resumeAnswer(item)
  const resume = item.resumeId != null ? (picker.byId.get(item.resumeId) ?? null) : null
  const renderable = resume !== null && isEditableResume(resume)
  const name = resume === null ? '' : renderable ? resume.label : (resume.filename ?? resume.label)

  const openMenu = (): void => {
    if (button.current) setMenu(resumeMenuTargetFromElement(item, button.current))
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h2 className="detail-section-title">Resume</h2>
      </div>

      <div className="detail-resume">
        {resume ? (
          <>
            <span className="detail-resume-name truncate" title={name}>
              <Icon name="doc" size={12} />
              {name}
            </span>
            {renderable ? null : (
              <span className="detail-resume-note tertiary">no longer stored</span>
            )}
          </>
        ) : (
          <span className="detail-resume-name tertiary">
            {answer === 'skipped' ? 'Not recorded.' : 'Which resume did you apply with?'}
          </span>
        )}

        <button ref={button} type="button" className="chip" onClick={openMenu}>
          {resume ? 'Change' : 'Choose…'}
        </button>
      </div>

      {menu ? (
        <ResumeMenu
          target={menu}
          resumes={picker.resumes}
          actions={picker.actions}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  )
}

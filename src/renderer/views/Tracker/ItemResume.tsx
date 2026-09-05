/**
 * The resume section of the item inspector: which resume this application was sent with.
 *
 * Mounts its own copy of the picker menu, so the inspector answers the question without
 * going back to the board. Renders nothing at all for an application that has not reached
 * Applied — there is no resume to have sent yet.
 */

import { useRef, useState, type JSX } from 'react'
import type { ItemSummary, Status } from '@shared/types'
import { Button, Icon, formatBytes } from '@renderer/components'
import { isAppliedOrLater, resumeAnswer } from '@shared/resume'
import { ResumeMenu, resumeMenuTargetFromElement, type ResumeMenuTarget } from './ResumeMenu'
import { useResumePicker } from './useResumePicker'

export function ItemResume({
  item,
  statuses
}: {
  item: ItemSummary
  statuses: readonly Status[]
}): JSX.Element | null {
  const picker = useResumePicker()
  const [menu, setMenu] = useState<ResumeMenuTarget | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)

  if (!isAppliedOrLater(item.statusKey, statuses)) return null

  const answer = resumeAnswer(item)
  const resume = item.resumeId != null ? (picker.byId.get(item.resumeId) ?? null) : null

  const openMenu = (): void => {
    if (button.current) setMenu(resumeMenuTargetFromElement(item, button.current))
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h2 className="detail-section-title">Resume</h2>
        {resume ? <span className="tertiary">{formatBytes(resume.size)}</span> : null}
      </div>

      <div className="detail-resume">
        {resume ? (
          <>
            <span className="detail-resume-name truncate" title={resume.filename}>
              <Icon name="doc" size={12} />
              {resume.label}
            </span>
            <Button size="sm" variant="outline" onClick={() => picker.actions.onOpenFile(resume.id)}>
              Open
            </Button>
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

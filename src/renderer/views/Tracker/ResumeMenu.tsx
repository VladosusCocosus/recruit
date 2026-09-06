/**
 * The resume picker for one application: which resume it was sent with.
 *
 * A menu rather than a dialog, for the same reason the status picker is one — it is a
 * choice among a short list of known things, and the board's other object actions already
 * live in this grammar. "Skip for now" is a row here, not a dismissal, so skipping is an
 * answer the item records rather than a question that keeps coming back.
 */

import type { JSX } from 'react'
import { isEditableResume, type ItemSummary, type Resume } from '@shared/types'
import { Menu, anchorFromElement, anchorFromEvent } from '@renderer/components'
import type { MenuAnchor, MenuNodeList } from '@renderer/components'
import { resumeAnswer } from '@shared/resume'

export interface ResumeMenuTarget {
  item: ItemSummary
  anchor: MenuAnchor
}

export function resumeMenuTargetFromElement(item: ItemSummary, el: HTMLElement): ResumeMenuTarget {
  return { item, anchor: anchorFromElement(el) }
}

export function resumeMenuTargetFromEvent(
  item: ItemSummary,
  e: { clientX: number; clientY: number }
): ResumeMenuTarget {
  return { item, anchor: anchorFromEvent(e) }
}

export interface ResumeMenuActions {
  onPick: (itemId: number, resumeId: number | null) => void
  onSkip: (itemId: number, skipped: boolean) => void
  /** Renders the resume to PDF and opens it. */
  onOpenPdf: (resumeId: number) => void
  /** Renders the resume to PDF and saves it where the user chooses. */
  onSavePdf: (resumeId: number) => void
  /** Opens Settings at the resume pane. */
  onOpenSettings: () => void
}

function rowLabel(resume: Resume): string {
  if (!isEditableResume(resume)) return `${resume.label} — no longer stored`
  const suffix = resume.isDefault
    ? ' — Default'
    : resume.usageCount > 0
      ? ` (${resume.usageCount})`
      : ''
  return `${resume.label}${suffix}`
}

function resumeMenuItems(
  item: ItemSummary,
  resumes: Resume[],
  actions: ResumeMenuActions
): MenuNodeList {
  const answer = resumeAnswer(item)
  const attached = item.resumeId
  const attachedResume = resumes.find((r) => r.id === attached) ?? null
  const renderable = attachedResume !== null && isEditableResume(attachedResume)

  const choices: MenuNodeList = resumes.map((resume) => ({
    kind: 'action' as const,
    id: `resume-${resume.id}`,
    label: rowLabel(resume),
    role: 'menuitemradio' as const,
    checked: resume.id === attached,
    onSelect: () => {
      if (resume.id === attached) return
      actions.onPick(item.id, resume.id)
    }
  }))

  return [
    resumes.length > 0 && { kind: 'section' as const, id: 'sec-applied', label: 'Applied with' },
    ...choices,
    { kind: 'separator' as const, id: 'sep-settings' },
    {
      kind: 'action' as const,
      id: 'settings',
      label: resumes.length > 0 ? 'Manage resumes in Settings…' : 'Add a resume in Settings…',
      onSelect: () => actions.onOpenSettings()
    },
    {
      kind: 'action' as const,
      id: 'skip',
      label: answer === 'skipped' ? 'Ask about this one again' : 'Skip for now',
      onSelect: () => actions.onSkip(item.id, answer !== 'skipped')
    },
    attached != null && { kind: 'separator' as const, id: 'sep-file' },
    renderable && {
      kind: 'action' as const,
      id: 'open-pdf',
      label: 'Open',
      onSelect: () => actions.onOpenPdf(attachedResume.id)
    },
    renderable && {
      kind: 'action' as const,
      id: 'save-pdf',
      label: 'Save PDF…',
      onSelect: () => actions.onSavePdf(attachedResume.id)
    },
    attached != null && {
      kind: 'action' as const,
      id: 'clear',
      label: 'Clear',
      onSelect: () => actions.onPick(item.id, null)
    }
  ]
}

export function ResumeMenu({
  target,
  resumes,
  actions,
  onClose
}: {
  target: ResumeMenuTarget
  resumes: Resume[]
  actions: ResumeMenuActions
  onClose: () => void
}): JSX.Element {
  const { item } = target
  return (
    <Menu
      anchor={target.anchor}
      items={resumeMenuItems(item, resumes, actions)}
      label={`Resume — ${item.company}`}
      returnFocusTo={`[data-item-focus="${item.id}"]`}
      onClose={onClose}
    />
  )
}

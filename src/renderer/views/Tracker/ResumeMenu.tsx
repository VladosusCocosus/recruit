/**
 * The resume picker for one application: which resume it was sent with.
 *
 * A menu rather than a dialog, for the same reason the status picker is one — it is a
 * choice among a short list of known things, and the board's other object actions already
 * live in this grammar. "Skip for now" is a row here, not a dismissal, so skipping is an
 * answer the item records rather than a question that keeps coming back.
 */

import type { JSX } from 'react'
import type { ItemSummary, Resume } from '@shared/types'
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
  /** Opens the file dialog, then attaches whatever comes back to this item. */
  onUpload: (itemId: number) => void
  onSkip: (itemId: number, skipped: boolean) => void
  onOpenFile: (resumeId: number) => void
  onRevealFile: (resumeId: number) => void
}

function rowLabel(resume: Resume): string {
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
    { kind: 'separator' as const, id: 'sep-upload' },
    {
      kind: 'action' as const,
      id: 'upload',
      label: resumes.length > 0 ? 'Upload a different resume…' : 'Upload a resume…',
      onSelect: () => actions.onUpload(item.id)
    },
    {
      kind: 'action' as const,
      id: 'skip',
      label: answer === 'skipped' ? 'Ask about this one again' : 'Skip for now',
      onSelect: () => actions.onSkip(item.id, answer !== 'skipped')
    },
    attached != null && { kind: 'separator' as const, id: 'sep-file' },
    attached != null && {
      kind: 'action' as const,
      id: 'open-file',
      label: 'Open',
      onSelect: () => actions.onOpenFile(attached)
    },
    attached != null && {
      kind: 'action' as const,
      id: 'reveal-file',
      label: 'Reveal in Finder',
      onSelect: () => actions.onRevealFile(attached)
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

/**
 * Screen 2: the tailored resume, before it becomes an application.
 *
 * Five regions — the extracted fields, the changes with a live preview of the document
 * they produce, the cover letter, the form's questions, and the gaps. The gap list is
 * read-only: a gap is a fact about the resume, not a pending edit, and nothing on it can
 * be turned into one.
 *
 * The cover letter and the questions are disclosures, shut on arrival, each with a
 * summary line naming what is inside. Only the diff is at full height.
 */

import { useState } from 'react'
import { Field, Icon, Markdown, Select, TextInput, pluralize } from '@renderer/components'
import type { JSX, ReactNode } from 'react'
import type { AppliedResume, Resume, TailorResult, WorkMode } from '@shared/types'
import { Answers, type AnswersStore } from '../Answers'
import { ChangeList } from './ChangeList'
import type { ApplyFields } from './useApply'

const WORK_MODE_OPTIONS: ReadonlyArray<{ value: WorkMode | ''; label: string }> = [
  { value: '', label: 'Not stated' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' }
]

const UNAPPLIED_REASON: Record<'not_found' | 'ambiguous', string> = {
  not_found: 'the text it replaces is not in your resume',
  ambiguous: 'the text it replaces appears more than once'
}

const COVER_LETTER_PLACEHOLDER =
  'The letter this application is sent with. Markdown; edit it as freely as you like.'

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

interface Props {
  result: TailorResult
  resume: Resume
  applied: AppliedResume | null
  fields: ApplyFields
  setField: <K extends keyof ApplyFields>(key: K, value: ApplyFields[K]) => void
  rejected: ReadonlySet<number>
  onToggle: (index: number, accepted: boolean) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  /** False when there is no template in Settings, so no letter was written. */
  hasCoverLetter: boolean
  coverLetterMd: string
  onCoverLetterChange: (markdown: string) => void
  answers: AnswersStore
  disabled: boolean
}

export function ReviewScreen({
  result,
  resume,
  applied,
  fields,
  setField,
  rejected,
  onToggle,
  onAcceptAll,
  onRejectAll,
  hasCoverLetter,
  coverLetterMd,
  onCoverLetterChange,
  answers,
  disabled
}: Props): JSX.Element {
  const unapplied = applied?.unapplied ?? []

  return (
    <div className="ap-review">
      <section className="ap-section">
        <div className="ap-section-head">
          <h3 className="ap-section-title">Application</h3>
          <span className="ap-section-note tertiary">Read off the job description</span>
        </div>
        <div className="ap-fields">
          <Field
            label="Company"
            error={fields.company.trim() === '' ? 'Required to file this application.' : null}
          >
            <TextInput
              value={fields.company}
              placeholder="Company"
              disabled={disabled}
              onValueChange={(v) => setField('company', v)}
            />
          </Field>
          <Field label="Role">
            <TextInput
              value={fields.role}
              placeholder="Not stated"
              disabled={disabled}
              onValueChange={(v) => setField('role', v)}
            />
          </Field>
          <Field label="Location">
            <TextInput
              value={fields.location}
              placeholder="Not stated"
              disabled={disabled}
              onValueChange={(v) => setField('location', v)}
            />
          </Field>
          <Field label="Work mode">
            <Select<WorkMode | ''>
              value={fields.workMode}
              options={WORK_MODE_OPTIONS}
              aria-label="Work mode"
              disabled={disabled}
              onValueChange={(v) => setField('workMode', v)}
            />
          </Field>
        </div>
      </section>

      <ChangeList
        changes={result.changes}
        rejected={rejected}
        onToggle={onToggle}
        onAcceptAll={onAcceptAll}
        onRejectAll={onRejectAll}
        disabled={disabled}
      />

      {unapplied.length > 0 ? (
        <div className="ap-unapplied" role="status">
          <Icon name="alert" size={13} />
          <div className="ap-unapplied-body">
            <p className="ap-unapplied-title">
              {pluralize(unapplied.length, 'change')} could not be located in your resume
            </p>
            <ul className="ap-unapplied-list">
              {unapplied.map((entry, i) => (
                <li key={`${entry.change.section}-${i}`}>
                  <span className="ap-unapplied-section">{entry.change.section}</span> —{' '}
                  {UNAPPLIED_REASON[entry.reason]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <section className="ap-section">
        <div className="ap-section-head">
          <h3 className="ap-section-title">Result</h3>
          <span className="ap-section-note tertiary truncate">
            {resume.label} · {pluralize(applied?.applied.length ?? 0, 'change')} applied
          </span>
        </div>
        <div className="ap-preview">
          {applied ? <Markdown source={applied.markdown} /> : null}
        </div>
      </section>

      <Disclosure
        title="Cover letter"
        summary={
          !hasCoverLetter
            ? 'No template — none will be sent'
            : coverLetterMd.trim() === ''
              ? 'Cleared — none will be sent'
              : `${pluralize(countWords(coverLetterMd), 'word')}, adapted for this job`
        }
      >
        {hasCoverLetter ? (
          <>
            <textarea
              className="input ap-letter"
              value={coverLetterMd}
              placeholder={COVER_LETTER_PLACEHOLDER}
              aria-label="Cover letter in markdown"
              disabled={disabled}
              onChange={(e) => onCoverLetterChange(e.currentTarget.value)}
            />
            <p className="ap-note tertiary">
              Your template, rewritten for {fields.company.trim() || 'this company'}. What is
              in the box is what gets filed — clear it to send no letter at all.
            </p>
          </>
        ) : (
          <p className="ap-note tertiary">
            No cover letter was written, because there is no template to adapt. Write one
            under Settings → Resume and the next tailor run will adapt it for the job.
          </p>
        )}
      </Disclosure>

      <Disclosure
        title="Questions on the form"
        summary={
          answers.cards.length === 0
            ? 'None added'
            : pluralize(answers.cards.length, 'question')
        }
      >
        <Answers store={answers} disabled={disabled} />
      </Disclosure>

      {result.gaps.length > 0 ? (
        <section className="ap-section">
          <div className="ap-section-head">
            <h3 className="ap-section-title">Gaps</h3>
            <span className="ap-section-note tertiary">{result.gaps.length}</span>
          </div>
          <p className="ap-note tertiary">
            What the job asks for that your resume does not show. Nothing here is edited into
            the document — it is what to prepare for the cover letter and the call.
          </p>
          <ul className="ap-gaps">
            {result.gaps.map((gap, i) => (
              <li className="ap-gap" key={`${gap.requirement}-${i}`}>
                <span className="ap-gap-req selectable">{gap.requirement}</span>
                <span className="ap-gap-note selectable">{gap.note}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/* ── a secondary region, shut until it is wanted ──────────────────────────── */

function Disclosure({
  title,
  summary,
  children
}: {
  title: string
  /** One line naming what is inside, shown while the section is shut. */
  summary: string
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <section className={'ap-section ap-fold' + (open ? ' is-open' : '')}>
      {/* A <button> takes phrasing content only. */}
      <button
        type="button"
        className="ap-fold-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="chevronRight" size={11} className="ap-fold-chevron" />
        <span className="ap-section-title">{title}</span>
        <span className="ap-section-note tertiary truncate">{summary}</span>
      </button>
      {open ? <div className="ap-fold-body">{children}</div> : null}
    </section>
  )
}

/**
 * Screen 2: the tailored resume, before it becomes an application.
 *
 * Three regions — the extracted fields, the changes with a live preview of the document
 * they produce, and the gaps. The gap list is read-only: a gap is a fact about the resume,
 * not a pending edit, and nothing on it can be turned into one.
 */

import { Field, Icon, Markdown, Select, TextInput, pluralize } from '@renderer/components'
import type { JSX } from 'react'
import type { AppliedResume, Resume, TailorResult, WorkMode } from '@shared/types'
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

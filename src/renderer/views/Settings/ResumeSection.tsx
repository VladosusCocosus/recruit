/**
 * Settings → Resume. One list of resumes as markdown, and the cover-letter template
 * underneath it.
 *
 * A row whose `contentMd` is null is a record of a file an application was sent before
 * resumes became markdown. The file itself is gone, so such a row can only be removed.
 */

import { useEffect, useState, type JSX } from 'react'
import { isEditableResume, type Resume } from '@shared/types'
import {
  Button,
  Chip,
  ErrorBanner,
  Icon,
  TextInput,
  errorMessage,
  formatRelative,
  pluralize,
  useAsync,
  useResumes
} from '@renderer/components'
import { SettingsBlock, SettingsRow, SettingsValue } from './SettingsGroup'

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

const RESUME_PLACEHOLDER = `# Ada Lovelace
Berlin · ada@example.com · github.com/ada

## Summary
Backend engineer, 9 years, distributed systems and payments.

## Experience

### Staff Engineer — Northwind Labs (2021–present)
- Cut checkout p99 latency from 1.8s to 240ms by …
- Led the migration of 40 services onto …

## Skills
Go, Postgres, Kafka, Terraform`

const COVER_LETTER_PLACEHOLDER = `Dear hiring team,

I am applying for the {role} role at {company}. I have spent the last nine years on
backend systems where latency and correctness both mattered — most recently cutting
checkout p99 from 1.8s to 240ms at Northwind Labs.

What draws me to this one is …

Ada Lovelace
ada@example.com`

interface RowActions {
  onMakeDefault: (id: number) => void
  onEdit: (resume: Resume) => void
  onSavePdf: (id: number) => void
  onOpenPdf: (id: number) => void
  onRemove: (id: number) => void
}

function ResumeRow({
  resume,
  busy,
  actions
}: {
  resume: Resume
  busy: boolean
  actions: RowActions
}): JSX.Element {
  const editable = isEditableResume(resume)
  const description = editable
    ? `${pluralize(countWords(resume.contentMd ?? ''), 'word')} · updated ${formatRelative(resume.updatedAt)}`
    : `${resume.filename ?? 'PDF'} · no longer stored`

  return (
    <SettingsRow
      label={
        <span className="set-resume-label">
          <Icon name="doc" size={12} />
          {resume.label}
          {resume.isDefault ? <Chip>Default</Chip> : null}
        </span>
      }
      description={description}
    >
      <span className="set-resume-actions">
        {editable && !resume.isDefault ? (
          <Button
            size="sm"
            variant="subtle"
            disabled={busy}
            onClick={() => actions.onMakeDefault(resume.id)}
          >
            Make default
          </Button>
        ) : null}
        {editable ? (
          <>
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => actions.onEdit(resume)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={busy}
              onClick={() => actions.onSavePdf(resume.id)}
            >
              Save PDF…
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={busy}
              onClick={() => actions.onOpenPdf(resume.id)}
            >
              Open
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => actions.onRemove(resume.id)}>
          Remove
        </Button>
      </span>
    </SettingsRow>
  )
}

/**
 * The one cover letter the tailor run works from. Same composer shape as the resume
 * editor above it: a markdown box, Save, and the word count.
 */
function CoverLetterTemplate(): JSX.Element {
  const state = useAsync(() => window.recruit.getCoverLetterTemplate(), [])
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stored = state.data ?? ''

  useEffect(() => {
    if (!dirty) setDraft(stored)
  }, [stored, dirty])

  const save = (): void => {
    setBusy(true)
    setError(null)
    window.recruit
      .setCoverLetterTemplate(draft)
      .then(() => {
        state.set(draft)
        setDirty(false)
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const revert = (): void => {
    setDraft(stored)
    setDirty(false)
  }

  let status: string
  if (state.loading) status = 'Loading…'
  else if (dirty) status = `${pluralize(countWords(draft), 'word')} · unsaved`
  else if (stored.trim() === '') status = 'No template — no cover letter will be written'
  else status = `${pluralize(countWords(stored), 'word')} · saved`

  return (
    <section className="set-block">
      <h3 className="set-block-title">Cover letter template</h3>
      <div className="stack">
        <textarea
          className="input mono"
          rows={14}
          value={draft}
          placeholder={COVER_LETTER_PLACEHOLDER}
          aria-label="Cover letter template in markdown"
          disabled={busy || state.loading}
          onChange={(e) => {
            setDraft(e.currentTarget.value)
            setDirty(true)
          }}
        />
        <div className="row">
          <Button size="sm" variant="primary" busy={busy} disabled={!dirty} onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="subtle" disabled={busy || !dirty} onClick={revert}>
            Revert
          </Button>
          <span className="tertiary">{status}</span>
        </div>
        {error ?? state.error ? (
          <p className="set-row-error selectable">{error ?? state.error}</p>
        ) : null}
      </div>
      <p className="set-block-foot">
        Markdown. The tailor run adapts this to the job it is reading — your voice, your
        facts, rewritten for that company and role — and the adapted letter is yours to edit
        before the application is filed. Leave this empty and no cover letter is written at
        all. Markdown joins consecutive lines into one paragraph, so an address block or a
        sign-off wants a blank line between its lines, or two spaces at the end of each.
      </p>
    </section>
  )
}

export function ResumeSection(): JSX.Element {
  const state = useResumes()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resumes = state.data ?? []
  const editing = resumes.find((r) => r.id === editingId) ?? null
  const composing = creating || editing !== null

  const run = (work: () => Promise<unknown>, after?: () => void): void => {
    setBusy(true)
    setError(null)
    void work()
      .then(() => after?.())
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const startEdit = (resume: Resume): void => {
    setCreating(false)
    setEditingId(resume.id)
    setDraftLabel(resume.label)
    setDraft(resume.contentMd ?? '')
    setError(null)
  }

  const startNew = (): void => {
    setEditingId(null)
    setCreating(true)
    setDraftLabel('')
    setDraft('')
    setError(null)
  }

  const closeComposer = (): void => {
    setEditingId(null)
    setCreating(false)
  }

  const save = (): void => {
    if (creating) {
      if (draft.trim().length === 0) {
        setError('Paste your resume before saving it.')
        return
      }
      run(
        () =>
          window.recruit.createResume({
            label: draftLabel.trim() || 'My resume',
            contentMd: draft
          }),
        closeComposer
      )
      return
    }
    if (!editing) return
    run(
      () =>
        window.recruit.updateResume(editing.id, {
          label: draftLabel.trim() || editing.label,
          contentMd: draft
        }),
      closeComposer
    )
  }

  const actions: RowActions = {
    onMakeDefault: (id) => run(() => window.recruit.setDefaultResume(id)),
    onEdit: startEdit,
    onSavePdf: (id) => run(() => window.recruit.saveResumePdf(id)),
    onOpenPdf: (id) => run(() => window.recruit.openResumePdf(id)),
    onRemove: (id) =>
      run(
        () => window.recruit.archiveResume(id),
        () => {
          if (editingId === id) setEditingId(null)
        }
      )
  }

  return (
    <>
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      <SettingsBlock
        title="Resumes"
        footnote="The markdown Apply tailors, rendered to PDF whenever you need a file. Removing one takes it out of the picker; applications already sent with it keep the record."
      >
        {resumes.length === 0 ? (
          <SettingsRow
            label="No resume yet"
            description="Apply needs one before it can tailor anything. Write it here, or import a markdown or text file."
          >
            <SettingsValue>—</SettingsValue>
          </SettingsRow>
        ) : (
          resumes.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} busy={busy} actions={actions} />
          ))
        )}

        <SettingsRow
          label="Add a resume"
          description="Paste it as markdown, or import a .md or .txt file. PDFs cannot be tailored — nothing can read them."
        >
          <Button size="sm" variant="outline" disabled={busy || composing} onClick={startNew}>
            Write one…
          </Button>
          <Button
            size="sm"
            variant="subtle"
            disabled={busy || composing}
            onClick={() => run(() => window.recruit.importResume())}
          >
            Import…
          </Button>
        </SettingsRow>
      </SettingsBlock>

      {composing ? (
        <section className="set-block">
          <h3 className="set-block-title">{editing ? `Editing ${editing.label}` : 'New resume'}</h3>
          <div className="stack">
            <TextInput
              value={draftLabel}
              aria-label="Resume name"
              placeholder={editing ? editing.label : 'My resume'}
              disabled={busy}
              onValueChange={setDraftLabel}
            />
            <textarea
              className="input mono"
              rows={18}
              value={draft}
              autoFocus={creating}
              placeholder={creating ? RESUME_PLACEHOLDER : undefined}
              aria-label={`${editing ? editing.label : 'New resume'} in markdown`}
              disabled={busy}
              onChange={(e) => setDraft(e.currentTarget.value)}
            />
            <div className="row">
              <Button size="sm" variant="primary" busy={busy} onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="subtle" disabled={busy} onClick={closeComposer}>
                Cancel
              </Button>
              <span className="tertiary">{pluralize(countWords(draft), 'word')}</span>
            </div>
          </div>
          <p className="set-block-foot">
            Markdown. Headings and bullets are what the tailor run matches on, so keep the
            structure it can find.
          </p>
        </section>
      ) : null}

      <CoverLetterTemplate />
    </>
  )
}

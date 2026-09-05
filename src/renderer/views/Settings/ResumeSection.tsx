/**
 * Settings → Resume. Three things, in the order they matter:
 *
 *   Master resumes — the markdown the apply flow tailors from. Edited in place.
 *   Default resume — the file offered first when an application asks what you sent.
 *   Library        — every file that has been attached to an application.
 *
 * The two halves are deliberately separate stores. A master is a living document; a
 * library file is a record of something already sent, and is never rewritten.
 *
 * Files are copied into the app's own storage when added, so a resume moved or renamed on
 * disk afterwards still opens. Removing one keeps the applications that were sent with it
 * pointing at it; it only leaves the picker.
 */

import { useState, type JSX } from 'react'
import type { Resume, ResumeMaster } from '@shared/types'
import {
  Button,
  Chip,
  ErrorBanner,
  Icon,
  TextInput,
  errorMessage,
  formatBytes,
  formatRelative,
  pluralize
} from '@renderer/components'
import { useResumeMasters, useResumes } from '@renderer/components'
import { SettingsBlock, SettingsRow, SettingsValue } from './SettingsGroup'

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

function ResumeRow({
  resume,
  busy,
  onMakeDefault,
  onReveal,
  onRemove
}: {
  resume: Resume
  busy: boolean
  onMakeDefault: (id: number) => void
  onReveal: (id: number) => void
  onRemove: (id: number) => void
}): JSX.Element {
  return (
    <SettingsRow
      label={
        <span className="set-resume-label">
          <Icon name="doc" size={12} />
          {resume.label}
          {resume.isDefault ? <Chip>Default</Chip> : null}
        </span>
      }
      description={`${resume.filename} · ${formatBytes(resume.size)} · ${
        resume.usageCount === 0 ? 'not used yet' : pluralize(resume.usageCount, 'application')
      }`}
    >
      {resume.isDefault ? null : (
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => onMakeDefault(resume.id)}>
          Make default
        </Button>
      )}
      <Button size="sm" variant="subtle" disabled={busy} onClick={() => onReveal(resume.id)}>
        Reveal
      </Button>
      <Button size="sm" variant="subtle" disabled={busy} onClick={() => onRemove(resume.id)}>
        Remove
      </Button>
    </SettingsRow>
  )
}

/* ── master resumes ────────────────────────────────────────────────────────── */

const MASTER_PLACEHOLDER = `# Ada Lovelace
Berlin · ada@example.com · github.com/ada

## Summary
Backend engineer, 9 years, distributed systems and payments.

## Experience

### Staff Engineer — Northwind Labs (2021–present)
- Cut checkout p99 latency from 1.8s to 240ms by …
- Led the migration of 40 services onto …

## Skills
Go, Postgres, Kafka, Terraform`

function MasterResumes(): JSX.Element {
  const state = useResumeMasters()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const masters = state.data ?? []
  const editing = masters.find((m) => m.id === editingId) ?? null
  const composing = creating || editing !== null

  const run = (work: () => Promise<unknown>, after?: () => void): void => {
    setBusy(true)
    setError(null)
    void work()
      .then(() => after?.())
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const startEdit = (master: ResumeMaster): void => {
    setCreating(false)
    setEditingId(master.id)
    setDraftLabel(master.label)
    setDraft(master.contentMd)
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
          window.recruit.createResumeMaster({
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
        window.recruit.updateResumeMaster(editing.id, {
          label: draftLabel.trim() || editing.label,
          contentMd: draft
        }),
      closeComposer
    )
  }

  return (
    <>
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      <SettingsBlock
        title="Master resumes"
        footnote="The markdown the apply flow tailors from. Editing one changes what future applications start from; the file each earlier application was sent with is untouched."
      >
        {masters.length === 0 ? (
          <SettingsRow
            label="No master resume yet"
            description="Apply needs one before it can tailor anything. Write it here, or import a markdown or text file."
          >
            <SettingsValue>—</SettingsValue>
          </SettingsRow>
        ) : (
          masters.map((master) => (
            <SettingsRow
              key={master.id}
              label={
                <span className="set-resume-label">
                  <Icon name="doc" size={12} />
                  {master.label}
                  {master.isDefault ? <Chip>Default</Chip> : null}
                </span>
              }
              description={`${pluralize(countWords(master.contentMd), 'word')} · updated ${formatRelative(master.updatedAt)}`}
            >
              {master.isDefault ? null : (
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => run(() => window.recruit.setDefaultResumeMaster(master.id))}
                >
                  Make default
                </Button>
              )}
              <Button
                size="sm"
                variant="subtle"
                disabled={busy}
                onClick={() => startEdit(master)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="subtle"
                disabled={busy}
                onClick={() =>
                  run(() => window.recruit.archiveResumeMaster(master.id), () => {
                    if (editingId === master.id) setEditingId(null)
                  })
                }
              >
                Remove
              </Button>
            </SettingsRow>
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
            onClick={() => run(() => window.recruit.importResumeMaster())}
          >
            Import…
          </Button>
        </SettingsRow>
      </SettingsBlock>

      {composing ? (
        <section className="set-block">
          <h3 className="set-block-title">
            {editing ? `Editing ${editing.label}` : 'New master resume'}
          </h3>
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
              placeholder={creating ? MASTER_PLACEHOLDER : undefined}
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
    </>
  )
}

/* ── uploaded resume files ─────────────────────────────────────────────────── */

export function ResumeSection(): JSX.Element {
  const state = useResumes()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resumes = state.data ?? []
  const fallback = resumes[0] ?? null
  const defaultResume = resumes.find((r) => r.isDefault) ?? null

  const run = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(null)
    void work()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const add = (makeDefault: boolean): void => run(() => window.recruit.addResume(makeDefault))

  return (
    <>
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      <MasterResumes />

      <SettingsBlock
        title="Default resume"
        footnote="The one offered first whenever an application asks which resume you applied with. Adding a resume copies the file into Jobbox's own storage, so renaming or moving the original later does not break it."
      >
        {defaultResume ? (
          <SettingsRow
            label={
              <span className="set-resume-label">
                <Icon name="doc" size={12} />
                {defaultResume.label}
              </span>
            }
            description={`${defaultResume.filename} · ${formatBytes(defaultResume.size)}`}
          >
            <Button size="sm" variant="outline" disabled={busy} onClick={() => add(true)}>
              Replace
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={busy}
              onClick={() => run(() => window.recruit.revealResume(defaultResume.id))}
            >
              Reveal
            </Button>
          </SettingsRow>
        ) : (
          <SettingsRow
            label="No default resume"
            description={
              fallback
                ? 'Pick one from the library below, or add another.'
                : 'Add the resume you send most often.'
            }
          >
            <Button size="sm" variant="outline" disabled={busy} onClick={() => add(true)}>
              Choose…
            </Button>
          </SettingsRow>
        )}
      </SettingsBlock>

      <SettingsBlock
        title="Library"
        footnote="Every resume you have attached to an application. Removing one takes it out of the picker; applications already sent with it keep the record."
      >
        {resumes.length === 0 ? (
          <SettingsRow label="Nothing here yet" description="Resumes you add appear in this list.">
            <SettingsValue>—</SettingsValue>
          </SettingsRow>
        ) : (
          resumes.map((resume) => (
            <ResumeRow
              key={resume.id}
              resume={resume}
              busy={busy}
              onMakeDefault={(id) => run(() => window.recruit.setDefaultResume(id))}
              onReveal={(id) => run(() => window.recruit.revealResume(id))}
              onRemove={(id) => run(() => window.recruit.archiveResume(id))}
            />
          ))
        )}

        <SettingsRow label="Add a resume" description="PDF, Word, Pages, RTF, or plain text.">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => add(resumes.length === 0)}>
            Add…
          </Button>
        </SettingsRow>
      </SettingsBlock>
    </>
  )
}

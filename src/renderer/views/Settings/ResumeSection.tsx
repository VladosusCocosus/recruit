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

function MasterResumes(): JSX.Element {
  const state = useResumeMasters()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const masters = state.data ?? []
  const editing = masters.find((m) => m.id === editingId) ?? null

  const run = (work: () => Promise<unknown>, after?: () => void): void => {
    setBusy(true)
    setError(null)
    void work()
      .then(() => after?.())
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const startEdit = (master: ResumeMaster): void => {
    setEditingId(master.id)
    setDraftLabel(master.label)
    setDraft(master.contentMd)
    setError(null)
  }

  const save = (): void => {
    if (!editing) return
    run(
      () =>
        window.recruit.updateResumeMaster(editing.id, {
          label: draftLabel.trim() || editing.label,
          contentMd: draft
        }),
      () => setEditingId(null)
    )
  }

  return (
    <>
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      <SettingsBlock
        title="Master resumes"
        footnote="The markdown the apply flow tailors from. Editing one changes what future applications start from; the file each earlier application was sent with is untouched. The first master is created the first time you use Apply."
      >
        {masters.length === 0 ? (
          <SettingsRow
            label="No master resume yet"
            description="Press Apply in the toolbar and paste one — it only asks once."
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
      </SettingsBlock>

      {editing ? (
        <section className="set-block">
          <h3 className="set-block-title">Editing {editing.label}</h3>
          <div className="stack">
            <TextInput
              value={draftLabel}
              aria-label="Resume name"
              placeholder={editing.label}
              disabled={busy}
              onValueChange={setDraftLabel}
            />
            <textarea
              className="input mono"
              rows={18}
              value={draft}
              aria-label={`${editing.label} in markdown`}
              disabled={busy}
              onChange={(e) => setDraft(e.currentTarget.value)}
            />
            <div className="row">
              <Button size="sm" variant="primary" busy={busy} onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="subtle" disabled={busy} onClick={() => setEditingId(null)}>
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

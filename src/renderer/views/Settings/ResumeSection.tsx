/**
 * Settings → Resume. The default resume, and the library every application picks from.
 *
 * Files are copied into the app's own storage when added, so a resume moved or renamed on
 * disk afterwards still opens. Removing one keeps the applications that were sent with it
 * pointing at it; it only leaves the picker.
 */

import { useState, type JSX } from 'react'
import type { Resume } from '@shared/types'
import { Button, Chip, ErrorBanner, Icon, errorMessage, formatBytes, pluralize } from '@renderer/components'
import { useResumes } from '@renderer/components'
import { SettingsBlock, SettingsRow, SettingsValue } from './SettingsGroup'

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

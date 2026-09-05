/**
 * The apply flow, as one modal with two screens.
 *
 * Screen 1 is one box — a job description or a link to one — plus the resume to tailor.
 * Screen 2 is the run, whatever it returns, and the review of the resulting document.
 * Tailor moves to screen 2 immediately; the run is watched there.
 *
 * Presentational: every piece of state, and the run itself, belongs to `useApply`.
 */

import { useState } from 'react'
import {
  Button,
  Field,
  Icon,
  LoadingState,
  Modal,
  Select,
  Spinner,
  TextInput,
  formatElapsed,
  formatToolName
} from '@renderer/components'
import type { JSX, ReactNode } from 'react'
import { ReviewScreen } from './ReviewScreen'
import type { ApplyStore } from './useApply'
import './apply.css'

interface Props {
  store: ApplyStore
  /** Where the filed application opens. */
  onOpenItem: (itemId: number) => void
}

export function ApplyModal({ store, onOpenItem }: Props): JSX.Element | null {
  if (!store.open) return null
  return <ApplyDialog store={store} onOpenItem={onOpenItem} />
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/** Which of the two screens' states is on show. Picks the title, the body and the footer. */
type Mode = 'loading' | 'unavailable' | 'first-run' | 'input' | 'running' | 'failed' | 'review'

function modeOf(store: ApplyStore): Mode {
  if (store.mastersLoading) return 'loading'
  if (store.masters.length === 0) {
    return store.mastersError === null ? 'first-run' : 'unavailable'
  }
  if (store.screen === 'input') return 'input'
  if (store.phase === 'running') return 'running'
  if (store.phase === 'ready' && store.result && store.master) return 'review'
  return 'failed'
}

function ApplyDialog({ store, onOpenItem }: Props): JSX.Element {
  const [masterLabel, setMasterLabel] = useState('My resume')
  const [masterDraft, setMasterDraft] = useState('')

  const mode = modeOf(store)
  const locked = mode === 'running' || store.committing || store.savingMaster

  const apply = async (): Promise<void> => {
    const itemId = await store.commit()
    if (itemId === null) return
    store.close()
    onOpenItem(itemId)
  }

  /* ── chrome ────────────────────────────────────────────────────────────── */

  let title: string
  let subtitle: ReactNode = null
  if (mode === 'unavailable') {
    title = 'Apply'
  } else if (mode === 'first-run') {
    title = 'Add your resume'
    subtitle = 'One time. Every tailored resume the apply flow writes starts from this one.'
  } else if (mode === 'running') {
    title = 'Tailoring your resume'
    subtitle = store.master?.label ?? null
  } else if (mode === 'failed') {
    title = 'The run came back with nothing'
  } else if (mode === 'review') {
    title = 'Review before you apply'
    subtitle =
      [store.fields.company.trim(), store.fields.role.trim()].filter(Boolean).join(' · ') || null
  } else {
    title = 'Apply to a job'
  }

  /* ── body ──────────────────────────────────────────────────────────────── */

  let body: ReactNode
  if (mode === 'loading') {
    body = <LoadingState label="Loading your resumes…" />
  } else if (mode === 'unavailable') {
    body = <ProblemBody title="Your resumes couldn't be read" message={store.mastersError} />
  } else if (mode === 'first-run') {
    body = (
      <FirstRunBody
        label={masterLabel}
        draft={masterDraft}
        saving={store.savingMaster}
        error={store.masterSaveError}
        onLabel={setMasterLabel}
        onDraft={setMasterDraft}
      />
    )
  } else if (mode === 'running') {
    body = (
      <RunBody
        elapsedMs={store.elapsedMs}
        currentTool={store.currentTool}
        stopping={store.stopping}
        fetching={store.jobSource === 'url'}
      />
    )
  } else if (mode === 'failed') {
    body = (
      <ProblemBody
        title="No tailored resume to review"
        message={store.runError ?? 'The run ended without returning a result.'}
        hint="Nothing was written. Retry the run, or go back and change what you pasted."
      />
    )
  } else if (mode === 'review' && store.result && store.master) {
    body = (
      <ReviewScreen
        result={store.result}
        master={store.master}
        applied={store.applied}
        fields={store.fields}
        setField={store.setField}
        rejected={store.rejected}
        onToggle={store.toggleChange}
        onAcceptAll={store.acceptAll}
        onRejectAll={store.rejectAll}
        disabled={store.committing}
      />
    )
  } else {
    body = <InputBody store={store} />
  }

  /* ── footer ────────────────────────────────────────────────────────────── */

  let footer: ReactNode
  if (mode === 'loading') {
    footer = null
  } else if (mode === 'unavailable') {
    footer = (
      <>
        <span className="ap-spacer" />
        <Button size="sm" variant="primary" onClick={store.close}>
          Close
        </Button>
      </>
    )
  } else if (mode === 'first-run') {
    footer = (
      <>
        <Button size="sm" variant="subtle" disabled={store.savingMaster} onClick={store.close}>
          Cancel
        </Button>
        <span className="ap-spacer" />
        <Button
          size="sm"
          variant="primary"
          busy={store.savingMaster}
          disabled={masterDraft.trim() === ''}
          onClick={() => void store.createMaster(masterLabel, masterDraft)}
        >
          Save resume
        </Button>
      </>
    )
  } else if (mode === 'running') {
    footer = (
      <>
        <span className="ap-spacer" />
        <Button size="sm" variant="outline" disabled={store.stopping} onClick={store.stop}>
          {store.stopping ? 'Stopping…' : 'Stop'}
        </Button>
      </>
    )
  } else if (mode === 'failed') {
    footer = (
      <>
        <Button size="sm" variant="subtle" onClick={store.close}>
          Cancel
        </Button>
        <span className="ap-spacer" />
        {store.tailorDisabledReason ? (
          <span className="ap-foot-reason tertiary">{store.tailorDisabledReason}</span>
        ) : null}
        <Button size="sm" variant="outline" onClick={store.backToInput}>
          Edit the job
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon="refresh"
          disabled={store.tailorDisabledReason !== null}
          onClick={store.retry}
        >
          Retry
        </Button>
      </>
    )
  } else if (mode === 'review') {
    footer = (
      <>
        <Button size="sm" variant="subtle" disabled={store.committing} onClick={store.close}>
          Cancel
        </Button>
        <span className="ap-spacer" />
        {store.commitError ? (
          <span className="ap-foot-error selectable">{store.commitError}</span>
        ) : store.commitDisabledReason ? (
          <span className="ap-foot-reason tertiary">{store.commitDisabledReason}</span>
        ) : null}
        <Button
          size="sm"
          variant="primary"
          busy={store.committing}
          disabled={store.commitDisabledReason !== null}
          onClick={() => void apply()}
        >
          Apply
        </Button>
      </>
    )
  } else {
    footer = (
      <>
        <Button size="sm" variant="subtle" onClick={store.close}>
          Cancel
        </Button>
        <span className="ap-spacer" />
        {store.tailorDisabledReason ? (
          <span className="ap-foot-reason tertiary">{store.tailorDisabledReason}</span>
        ) : null}
        <Button
          size="sm"
          variant="primary"
          icon="sparkle"
          disabled={store.tailorDisabledReason !== null}
          onClick={store.tailor}
        >
          Tailor
        </Button>
      </>
    )
  }

  return (
    <Modal
      open
      onClose={store.close}
      locked={locked}
      width={mode === 'review' || mode === 'running' || mode === 'failed' ? 'document' : 'wide'}
      title={title}
      subtitle={subtitle}
      footer={footer}
    >
      {body}
    </Modal>
  )
}

/* ── screen 1 ─────────────────────────────────────────────────────────────── */

function InputBody({ store }: { store: ApplyStore }): JSX.Element {
  const isUrl = store.jobSource === 'url'
  const filled = store.jobInput.trim() !== ''

  const hint = !filled ? (
    <span className="ap-mode">A whole posting pasted in, or one link to it.</span>
  ) : isUrl ? (
    <span className="ap-mode is-url">
      <Icon name="link" size={11} />
      Will fetch this link
    </span>
  ) : (
    <span className="ap-mode">
      <Icon name="doc" size={11} />
      Job description · {countWords(store.jobInput)} words
    </span>
  )

  return (
    <div className="ap-input">
      <Field label="The job" hint={hint}>
        <textarea
          className="input ap-job"
          autoFocus
          value={store.jobInput}
          placeholder={'Paste the job description here — or a link to it, on its own.'}
          onChange={(e) => store.setJobInput(e.currentTarget.value)}
        />
      </Field>

      <Field label="Resume" hint="Tailored into a copy. Your master is never edited.">
        {store.masters.length > 1 ? (
          <Select
            value={String(store.master?.id ?? '')}
            options={store.masters.map((m) => ({
              value: String(m.id),
              label: m.isDefault ? `${m.label} (default)` : m.label
            }))}
            aria-label="Resume to tailor"
            onValueChange={(v) => store.selectMaster(Number(v))}
          />
        ) : (
          <div className="ap-resume-one">
            <Icon name="doc" size={12} />
            <span className="truncate">{store.master?.label ?? '—'}</span>
          </div>
        )}
      </Field>

      {store.mastersError ? (
        <p className="ap-error selectable">{store.mastersError}</p>
      ) : null}
    </div>
  )
}

/* ── screen 1, before there is a master ───────────────────────────────────── */

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

function FirstRunBody({
  label,
  draft,
  saving,
  error,
  onLabel,
  onDraft
}: {
  label: string
  draft: string
  saving: boolean
  error: string | null
  onLabel: (value: string) => void
  onDraft: (value: string) => void
}): JSX.Element {
  const words = countWords(draft)
  return (
    <div className="ap-first">
      <p className="ap-first-lede">
        Paste your resume as markdown. It stays on this machine, it is what every tailored
        copy is built from, and you can edit it later in Settings → Resume. Headings and
        bullets are enough — the tailor run matches on the text, not the layout.
      </p>

      <Field label="Name it">
        <TextInput
          value={label}
          placeholder="My resume"
          disabled={saving}
          onValueChange={onLabel}
        />
      </Field>

      <Field
        label="Your resume, in markdown"
        hint={
          words === 0
            ? 'Nothing pasted yet.'
            : words < 120
              ? `${words} words — short for a resume, but it is yours to judge.`
              : `${words} words.`
        }
      >
        <textarea
          className="input ap-master"
          autoFocus
          value={draft}
          placeholder={RESUME_PLACEHOLDER}
          disabled={saving}
          onChange={(e) => onDraft(e.currentTarget.value)}
        />
      </Field>

      {error ? <p className="ap-error selectable">{error}</p> : null}
    </div>
  )
}

/* ── screen 2: the run ────────────────────────────────────────────────────── */

function RunBody({
  elapsedMs,
  currentTool,
  stopping,
  fetching
}: {
  elapsedMs: number
  currentTool: string | null
  stopping: boolean
  fetching: boolean
}): JSX.Element {
  const tool = formatToolName(currentTool)
  const label = stopping ? 'Stopping…' : tool || 'Thinking…'
  return (
    <div className="ap-run">
      <div className="ap-run-line" role="status" aria-live="polite">
        <Spinner size={13} label="" />
        <span className="ap-run-elapsed tabular">{formatElapsed(elapsedMs)}</span>
        <span className="ap-run-sep">·</span>
        <span className="ap-run-tool truncate" title={currentTool ?? label}>
          {label}
        </span>
      </div>

      {/* Indeterminate: a tailor run reports no countable unit of work. */}
      <span
        className="ap-run-bar"
        role="progressbar"
        aria-label="Tailoring your resume"
        aria-valuetext={`${formatElapsed(elapsedMs)} elapsed`}
      />

      <p className="ap-run-note tertiary">
        {fetching
          ? 'Fetching the posting, then reading it against your resume.'
          : 'Reading the description against your resume.'}{' '}
        Nothing is filed until you have seen what it wants to change.
      </p>
    </div>
  )
}

/** A dead end that is still an answer: the run's failure, or a store that would not load. */
function ProblemBody({
  title,
  message,
  hint
}: {
  title: string
  message: string | null
  hint?: string
}): JSX.Element {
  return (
    <div className="ap-failed" role="alert">
      <span className="ap-failed-icon">
        <Icon name="alert" size={15} />
      </span>
      <div>
        <p className="ap-failed-title">{title}</p>
        {message ? <p className="ap-failed-text selectable">{message}</p> : null}
        {hint ? <p className="ap-failed-hint tertiary">{hint}</p> : null}
      </div>
    </div>
  )
}

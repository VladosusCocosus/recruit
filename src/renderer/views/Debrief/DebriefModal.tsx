/**
 * The post-call debrief form: outcome, notes, follow-ups and a recruiter nudge.
 *
 * The notes become a `note` timeline event; each follow-up and the nudge become `task`
 * events with due dates. Saving does not change the application's status.
 */
import { useMemo, useState } from 'react'
import { Button, Field, Icon, IconButton, Modal, Segmented, TextInput } from '@renderer/components'
import { defaultNudgeAt, defaultNudgeTitle } from '@shared/debrief'
import {
  CALL_OUTCOME_LABEL,
  CALL_TYPE_LABEL,
  type CallDebriefInput,
  type CallOutcome,
  type DebriefFollowUp,
  type PendingDebrief
} from '@shared/types'
import type { JSX } from 'react'
import { fromDateInputValue, toDateInputValue, tomorrowInputValue } from './dates'
import { callWhen } from './format'
import './debrief.css'

interface Props {
  call: PendingDebrief
  onSave: (input: CallDebriefInput) => Promise<void>
  onSnooze: (eventId: number) => Promise<void>
  onSkip: (eventId: number) => Promise<void>
  onClose: () => void
}

interface DraftFollowUp {
  /** Local only — React needs a stable key across reorders and deletions. */
  key: number
  title: string
  due: string
}

const OUTCOMES: ReadonlyArray<{ value: CallOutcome; label: string }> = [
  { value: 'well', label: CALL_OUTCOME_LABEL.well },
  { value: 'mixed', label: CALL_OUTCOME_LABEL.mixed },
  { value: 'badly', label: CALL_OUTCOME_LABEL.badly }
]

export function DebriefModal({ call, onSave, onSnooze, onSkip, onClose }: Props): JSX.Element {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [followUps, setFollowUps] = useState<DraftFollowUp[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [nudgeOn, setNudgeOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const who = call.callWith ?? call.item.contactName
  const defaults = useMemo(
    () => ({
      title: defaultNudgeTitle(who, call.item.role, call.item.company),
      due: toDateInputValue(defaultNudgeAt(call.endsAt ?? new Date().toISOString()))
    }),
    [who, call.item.role, call.item.company, call.endsAt]
  )
  const [nudgeTitle, setNudgeTitle] = useState(defaults.title)
  const [nudgeDue, setNudgeDue] = useState(defaults.due)

  const addFollowUp = (): void => {
    setFollowUps((rows) => [...rows, { key: nextKey, title: '', due: tomorrowInputValue() }])
    setNextKey((k) => k + 1)
  }

  const patchFollowUp = (key: number, patch: Partial<DraftFollowUp>): void => {
    setFollowUps((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeFollowUp = (key: number): void => {
    setFollowUps((rows) => rows.filter((r) => r.key !== key))
  }

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const submit = (): void => {
    if (outcome === null) {
      setError('Pick how the call went first.')
      return
    }
    const tasks: DebriefFollowUp[] = []
    for (const row of followUps) {
      const title = row.title.trim()
      const dueAt = fromDateInputValue(row.due)
      if (title && dueAt) tasks.push({ title, dueAt })
    }
    const nudgeAt = fromDateInputValue(nudgeDue)
    const nudge =
      nudgeOn && nudgeTitle.trim() && nudgeAt ? { title: nudgeTitle.trim(), dueAt: nudgeAt } : null

    void guard(() =>
      onSave({ eventId: call.id, outcome, notes: notes.trim() || null, followUps: tasks, nudge })
    )
  }

  const subtitle = (
    <>
      <div className="db-sub-line">
        {call.callType ? `${CALL_TYPE_LABEL[call.callType]}` : 'Call'}
        {who ? ` — ${who}` : ''}
      </div>
      <div className="db-sub-line tertiary">
        {call.item.role ? `${call.item.company} · ${call.item.role}` : call.item.company}
        {' · '}
        {callWhen(call)}
      </div>
    </>
  )

  const footer = (
    <>
      <Button size="sm" variant="subtle" disabled={busy} onClick={() => void guard(() => onSkip(call.id))}>
        Skip
      </Button>
      <span className="db-foot-spacer" />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void guard(() => onSnooze(call.id))}
      >
        Remind me later
      </Button>
      <Button size="sm" variant="primary" disabled={busy} onClick={submit}>
        Save debrief
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      locked={busy}
      title="How did it go?"
      subtitle={subtitle}
      footer={footer}
    >
      <div className="db-outcome">
        {/* The empty string is the unanswered state — no segment is active. */}
        <Segmented<CallOutcome | ''>
          aria-label="How the call went"
          value={outcome ?? ''}
          options={OUTCOMES}
          onValueChange={(v) => {
            if (!v) return
            setOutcome(v)
            setError(null)
          }}
        />
      </div>

      <Field label="Notes" hint="Markdown is fine. Lands on the timeline as a note.">
        <textarea
          className="input db-notes"
          autoFocus
          value={notes}
          placeholder="What was asked, who was in the room, what they said about next steps…"
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
      </Field>

      <div className="db-section">
        <div className="db-section-head">
          <span className="db-section-label">Follow-ups</span>
          <Button size="sm" variant="subtle" icon="plus" onClick={addFollowUp}>
            Add
          </Button>
        </div>

        {followUps.length === 0 ? (
          <p className="db-hint tertiary">Anything you promised on the call. Each becomes a task.</p>
        ) : (
          <div className="db-rows">
            {followUps.map((row) => (
              <div className="db-row" key={row.key}>
                <TextInput
                  value={row.title}
                  onValueChange={(v) => patchFollowUp(row.key, { title: v })}
                  placeholder="Send the take-home repo link"
                />
                <input
                  className="input db-date"
                  type="date"
                  value={row.due}
                  onChange={(e) => patchFollowUp(row.key, { due: e.currentTarget.value })}
                />
                <IconButton
                  icon="x"
                  label="Remove follow-up"
                  onClick={() => removeFollowUp(row.key)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={'db-nudge' + (nudgeOn ? ' is-on' : '')}>
        <div className="db-nudge-head">
          <Icon name="clock" size={13} />
          <span className="db-nudge-title">Nudge if you haven't heard back</span>
          <input
            type="checkbox"
            aria-label="Remind me to chase this"
            checked={nudgeOn}
            onChange={(e) => setNudgeOn(e.currentTarget.checked)}
          />
        </div>
        {nudgeOn ? (
          <div className="db-row db-nudge-row">
            <TextInput value={nudgeTitle} onValueChange={setNudgeTitle} />
            <input
              className="input db-date"
              type="date"
              value={nudgeDue}
              onChange={(e) => setNudgeDue(e.currentTarget.value)}
            />
          </div>
        ) : null}
      </div>

      {error ? <p className="db-error">{error}</p> : null}
    </Modal>
  )
}

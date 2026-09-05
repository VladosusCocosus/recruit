/**
 * "Log a call" — the composer for a call on an application's timeline.
 *
 * Writes a `meeting` event with `callType` and `callWith` set, which is what enrols it in
 * the debrief queue. The title is derived from those two fields. An end stamp is required
 * and the start may be in the past.
 */
import { useState } from 'react'
import { Button, Field, FieldRow, Select, TextInput } from '@renderer/components'
import { CALL_TYPES, CALL_TYPE_LABEL, type CallType } from '@shared/types'
import type { JSX } from 'react'
import type { NewEntry } from './AddEntry'
import { fromLocalInputValue, nowIso, toLocalInputValue } from './format'

/** How long a call is assumed to run when you don't say. */
const DEFAULT_MINUTES = 30

const TYPE_OPTIONS = CALL_TYPES.map((value) => ({ value, label: CALL_TYPE_LABEL[value] }))

function defaultEnd(startsAt: string): string {
  const t = Date.parse(startsAt)
  if (!Number.isFinite(t)) return ''
  return toLocalInputValue(new Date(t + DEFAULT_MINUTES * 60_000).toISOString())
}

export function callTitle(callType: CallType, callWith: string): string {
  const who = callWith.trim()
  return who ? `${CALL_TYPE_LABEL[callType]} — ${who}` : CALL_TYPE_LABEL[callType]
}

export function LogCall({
  onSubmit,
  onCancel,
  defaultWith
}: {
  onSubmit: (entry: NewEntry) => void
  onCancel: () => void
  /** The item's contact, so the common case needs no typing. */
  defaultWith?: string | null
}): JSX.Element {
  const [callType, setCallType] = useState<CallType>('recruiter_screen')
  const [callWith, setCallWith] = useState(defaultWith ?? '')
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(nowIso()))
  const [endsAt, setEndsAt] = useState(() => defaultEnd(nowIso()))
  const [meetingUrl, setMeetingUrl] = useState('')
  const [prep, setPrep] = useState('')

  const start = fromLocalInputValue(startsAt)
  const end = fromLocalInputValue(endsAt)
  const badRange = start !== null && end !== null && end < start
  const disabled = start === null || end === null || badRange

  // Moving the start also moves an end that still holds its derived value.
  const changeStart = (value: string): void => {
    const previous = start
    setStartsAt(value)
    const next = fromLocalInputValue(value)
    if (!next) return
    if (end === null || (previous !== null && end === defaultEnd(previous))) {
      setEndsAt(defaultEnd(next))
    }
  }

  const submit = (): void => {
    if (disabled) return
    onSubmit({
      kind: 'meeting',
      title: callTitle(callType, callWith),
      bodyMd: prep.trim() || null,
      startsAt: start,
      endsAt: end,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      meetingUrl: meetingUrl.trim() || null,
      callType,
      callWith: callWith.trim() || null,
      source: 'user'
    })
  }

  return (
    <form
      className="add-entry-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <FieldRow>
        <Field label="Kind" narrow>
          <Select value={callType} onValueChange={setCallType} options={TYPE_OPTIONS} />
        </Field>
        <Field label="With">
          <TextInput
            autoFocus
            value={callWith}
            onValueChange={setCallWith}
            placeholder="Who you're speaking to"
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Starts">
          <input
            className="input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => changeStart(e.currentTarget.value)}
          />
        </Field>
        <Field
          label="Ends"
          error={badRange ? 'Ends before it starts.' : end === null ? 'Required.' : null}
        >
          <input
            className="input"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.currentTarget.value)}
          />
        </Field>
      </FieldRow>

      <Field label="Meeting link">
        <TextInput
          value={meetingUrl}
          onValueChange={setMeetingUrl}
          placeholder="https://meet.google.com/…"
        />
      </Field>

      <Field label="Prep notes" hint="What to ask, what to have ready.">
        <textarea
          className="input"
          value={prep}
          placeholder="Ask about team size and the on-call rotation…"
          onChange={(e) => setPrep(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
      </Field>

      <div className="row">
        <Button variant="primary" size="sm" disabled={disabled} onClick={submit}>
          Log call
        </Button>
        <Button size="sm" variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <span className="tertiary add-entry-hint">Jobbox asks how it went afterwards.</span>
      </div>
    </form>
  )
}

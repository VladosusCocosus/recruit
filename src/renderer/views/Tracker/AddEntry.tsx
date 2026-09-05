/**
 * Inline composers for the manual timeline actions: "Add note", "Add event" and
 * "Log a call". Inline rather than modal — the timeline stays on screen while you write.
 */

import { useState } from 'react'
import { Button, Field, FieldRow, Select, TextInput } from '@renderer/components'
import type { JSX } from 'react'
import type { TimelineEventInput } from '@shared/types'
import { LogCall } from './LogCall'
import { fromLocalInputValue, nowIso, toLocalInputValue } from './format'

type Mode = 'none' | 'note' | 'event' | 'call'

export type NewEntry = Omit<TimelineEventInput, 'itemId'>

/** First line of a note becomes its title so the timeline row has something to show. */
function titleFromBody(body: string): string {
  const first = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'Note'
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

function NoteForm({
  onSubmit,
  onCancel
}: {
  onSubmit: (entry: NewEntry) => void
  onCancel: () => void
}): JSX.Element {
  const [body, setBody] = useState('')
  const disabled = body.trim().length === 0

  // The shared Button is always type="button", so the form is submitted by calling this
  // directly; onSubmit stays wired for the Enter key.
  const submit = (): void => {
    if (disabled) return
    onSubmit({
      kind: 'note',
      title: titleFromBody(body),
      bodyMd: body.trim(),
      occurredAt: nowIso(),
      source: 'user'
    })
    setBody('')
  }

  return (
    <form
      className="add-entry-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Field label="Note" hint="Markdown is fine.">
        <textarea
          className="input"
          autoFocus
          value={body}
          placeholder="Recruiter said the loop is 4 rounds…"
          onChange={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
      </Field>
      <div className="row">
        <Button variant="primary" size="sm" disabled={disabled} onClick={submit}>
          Add note
        </Button>
        <Button size="sm" variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function EventForm({
  onSubmit,
  onCancel
}: {
  onSubmit: (entry: NewEntry) => void
  onCancel: () => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'meeting' | 'task'>('meeting')
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(nowIso()))
  const [endsAt, setEndsAt] = useState('')
  const [location, setLocation] = useState('')
  const [meetingUrl, setMeetingUrl] = useState('')

  const start = fromLocalInputValue(startsAt)
  const end = fromLocalInputValue(endsAt)
  const badRange = start !== null && end !== null && end < start
  const disabled = title.trim().length === 0 || start === null || badRange

  const submit = (): void => {
    if (disabled) return
    onSubmit({
      kind,
      title: title.trim(),
      startsAt: start,
      endsAt: end,
      // The browser's zone is the one the user typed in; recording it keeps the row
      // readable if they later look at it from a different one.
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      location: location.trim() || null,
      meetingUrl: meetingUrl.trim() || null,
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
      <Field label="Title">
        <TextInput
          autoFocus
          value={title}
          onValueChange={setTitle}
          placeholder="Onsite — system design"
        />
      </Field>

      <FieldRow>
        <Field label="Kind" narrow>
          <Select
            value={kind}
            onValueChange={setKind}
            options={[
              { value: 'meeting', label: 'Meeting' },
              { value: 'task', label: 'Task' }
            ]}
          />
        </Field>
        <Field label="Starts">
          <input
            className="input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.currentTarget.value)}
          />
        </Field>
        <Field label="Ends" error={badRange ? 'Ends before it starts.' : null}>
          <input
            className="input"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.currentTarget.value)}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Location">
          <TextInput value={location} onValueChange={setLocation} placeholder="Optional" />
        </Field>
        <Field label="Meeting link">
          <TextInput
            value={meetingUrl}
            onValueChange={setMeetingUrl}
            placeholder="https://meet.google.com/…"
          />
        </Field>
      </FieldRow>

      <div className="row">
        <Button variant="primary" size="sm" disabled={disabled} onClick={submit}>
          Add event
        </Button>
        <Button size="sm" variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function AddEntry({
  onAdd,
  contactName
}: {
  onAdd: (entry: NewEntry) => void
  /** Seeds "Log a call" with the recruiter already on the application. */
  contactName?: string | null
}): JSX.Element {
  const [mode, setMode] = useState<Mode>('none')
  const close = (): void => setMode('none')
  const submit = (entry: NewEntry): void => {
    onAdd(entry)
    close()
  }

  if (mode === 'note') return <NoteForm onSubmit={submit} onCancel={close} />
  if (mode === 'event') return <EventForm onSubmit={submit} onCancel={close} />
  if (mode === 'call')
    return <LogCall onSubmit={submit} onCancel={close} defaultWith={contactName} />

  return (
    <div className="row add-entry-actions">
      <Button size="sm" variant="outline" icon="plus" onClick={() => setMode('note')}>
        Add note
      </Button>
      <Button size="sm" variant="outline" icon="calendar" onClick={() => setMode('event')}>
        Add event
      </Button>
      <Button size="sm" variant="outline" icon="clock" onClick={() => setMode('call')}>
        Log a call
      </Button>
      <span className="tertiary add-entry-hint">Manual entries are marked as yours.</span>
    </div>
  )
}

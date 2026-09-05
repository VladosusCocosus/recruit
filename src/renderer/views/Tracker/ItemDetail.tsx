/**
 * Item detail: header, description, timeline, linked mail.
 */

import { useEffect, useState } from 'react'
import {
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  FieldRow,
  Icon,
  IconButton,
  List,
  ListRow,
  LoadingState,
  Select,
  StatusBadge,
  TextInput,
  formatListDate,
  formatRelative,
  pluralize
} from '@renderer/components'
import type { JSX } from 'react'
import type { ItemDetail as ItemDetailData, ItemPatch, WorkMode } from '@shared/types'
import { AddEntry } from './AddEntry'
import { Description } from './Description'
import { ItemResume } from './ItemResume'
import { closeReasonLabel, formatDateTime, lastMessageAt, staleness } from './format'
import { StatusSelect } from './StatusSelect'
import { Timeline } from './Timeline'
import { useItemDetail, type StatusIndex } from './useTracker'

const WORK_MODES = [
  { value: '' as const, label: '—' },
  { value: 'onsite' as const, label: 'Onsite' },
  { value: 'hybrid' as const, label: 'Hybrid' },
  { value: 'remote' as const, label: 'Remote' }
]

function openExternal(url: string): void {
  void window.recruit.openExternal(url)
}

function FieldsEditor({
  item,
  onSave,
  onCancel
}: {
  item: ItemDetailData
  onSave: (patch: ItemPatch) => void
  onCancel: () => void
}): JSX.Element {
  const [draft, setDraft] = useState({
    company: item.company,
    role: item.role ?? '',
    location: item.location ?? '',
    workMode: (item.workMode ?? '') as WorkMode | '',
    companyDomain: item.companyDomain ?? '',
    source: item.source ?? '',
    jobUrl: item.jobUrl ?? '',
    compensationNote: item.compensationNote ?? '',
    contactName: item.contactName ?? '',
    contactEmail: item.contactEmail ?? ''
  })

  const set = <K extends keyof typeof draft>(key: K) =>
    (value: (typeof draft)[K]): void =>
      setDraft((d) => ({ ...d, [key]: value }))
  const trimmed = (v: string): string | null => (v.trim() === '' ? null : v.trim())

  const submit = (): void => {
    if (draft.company.trim() === '') return
    onSave({
          company: draft.company.trim(),
          role: trimmed(draft.role),
          location: trimmed(draft.location),
          workMode: draft.workMode === '' ? null : draft.workMode,
          companyDomain: trimmed(draft.companyDomain),
          source: trimmed(draft.source),
          jobUrl: trimmed(draft.jobUrl),
          compensationNote: trimmed(draft.compensationNote),
          contactName: trimmed(draft.contactName),
      contactEmail: trimmed(draft.contactEmail)
    })
  }

  return (
    <form
      className="detail-editor"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <FieldRow>
        <Field label="Company">
          <TextInput value={draft.company} onValueChange={set('company')} />
        </Field>
        <Field label="Role">
          <TextInput value={draft.role} onValueChange={set('role')} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Location">
          <TextInput value={draft.location} onValueChange={set('location')} />
        </Field>
        <Field label="Work mode" narrow>
          <Select value={draft.workMode} options={WORK_MODES} onValueChange={set('workMode')} />
        </Field>
        <Field label="Domain" hint="Drives the prefilter's company match.">
          <TextInput
            value={draft.companyDomain}
            onValueChange={set('companyDomain')}
            placeholder="acme.com"
          />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Source">
          <TextInput
            value={draft.source}
            onValueChange={set('source')}
            placeholder="LinkedIn, referral…"
          />
        </Field>
        <Field label="Job URL">
          <TextInput type="url" value={draft.jobUrl} onValueChange={set('jobUrl')} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Contact">
          <TextInput value={draft.contactName} onValueChange={set('contactName')} />
        </Field>
        <Field label="Contact email">
          <TextInput
            type="email"
            value={draft.contactEmail}
            onValueChange={set('contactEmail')}
          />
        </Field>
        <Field label="Compensation">
          <TextInput value={draft.compensationNote} onValueChange={set('compensationNote')} />
        </Field>
      </FieldRow>
      <div className="row">
        <Button variant="primary" size="sm" onClick={submit}>
          Save
        </Button>
        <Button size="sm" variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ItemDetail({
  itemId,
  statusIndex,
  now,
  onBack,
  onOpenMessage
}: {
  itemId: number | null
  statusIndex: StatusIndex
  now: number
  onBack?: () => void
  onOpenMessage?: (messageId: number) => void
}): JSX.Element {
  const store = useItemDetail(itemId)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { detail } = store

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
  }, [itemId])

  if (itemId === null) {
    return <EmptyState title="No application selected" message="Pick a card to see its history." />
  }
  if (store.loading && !detail) return <LoadingState />
  if (!detail) {
    return (
      <EmptyState
        icon="alert"
        title="Application not found"
        message="It may have been deleted."
        actions={onBack ? <Button onClick={onBack}>Back to board</Button> : null}
      />
    )
  }

  const status = statusIndex.byKey.get(detail.statusKey) ?? null
  const kind = statusIndex.kindOf(detail)
  const reason = closeReasonLabel(detail.closeReason)
  const stale = staleness(detail, kind, now)
  const lastMessage = lastMessageAt(detail)

  return (
    <div className="item-detail">
      {store.error ? <ErrorBanner error={store.error} onDismiss={store.clearError} /> : null}

      <header className="detail-header">
        <div className="detail-header-top">
          {onBack ? <IconButton icon="x" label="Close" onClick={onBack} /> : null}
          <div className="detail-headings">
            <h1 className="detail-company selectable">{detail.company}</h1>
            <div className="detail-role secondary selectable">
              {detail.role ?? 'No role recorded'}
            </div>
          </div>
          <div className="detail-header-actions">
            <StatusSelect
              item={detail}
              statusIndex={statusIndex}
              onChange={(statusKey, closeReason) => void store.setStatus(statusKey, closeReason)}
            />
            <Button size="sm" variant="subtle" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Close' : 'Edit'}
            </Button>
          </div>
        </div>

        <div className="detail-meta row-wrap">
          <StatusBadge status={status} statusKey={detail.statusKey} />
          {reason ? <Chip>{reason}</Chip> : null}
          {detail.archivedAt ? <Chip>Archived</Chip> : null}
          {stale.stale ? (
            <span className="chip is-stale" title={`Nothing heard for ${stale.days} days`}>
              Stale · {stale.days}d quiet
            </span>
          ) : null}
          {detail.location ? <Chip>{detail.location}</Chip> : null}
          {detail.workMode ? <Chip>{detail.workMode}</Chip> : null}
          {detail.source ? <Chip>via {detail.source}</Chip> : null}
          {detail.compensationNote ? <Chip>{detail.compensationNote}</Chip> : null}
          {detail.jobUrl ? (
            <button
              type="button"
              className="chip is-link"
              title={detail.jobUrl}
              onClick={() => openExternal(detail.jobUrl as string)}
            >
              <Icon name="external" size={10} />
              Job posting
            </button>
          ) : null}
          {detail.contactEmail || detail.contactName ? (
            <Chip title={detail.contactEmail ?? undefined}>
              {detail.contactName ?? detail.contactEmail}
            </Chip>
          ) : null}
          <span className="tertiary detail-dates">
            Added {formatListDate(detail.createdAt, now)} ·{' '}
            {lastMessage ? (
              <>
                last message{' '}
                <span title={formatDateTime(lastMessage)}>
                  {formatRelative(lastMessage, now)}
                </span>
              </>
            ) : (
              'no messages yet'
            )}
          </span>
        </div>

        {editing ? (
          <FieldsEditor
            item={detail}
            onCancel={() => setEditing(false)}
            onSave={(patch) => {
              void store.patch(patch)
              setEditing(false)
            }}
          />
        ) : null}
      </header>

      <div className="detail-body">
        <Description item={detail} now={now} onSave={(md) => store.saveDescription(md)} />

        <ItemResume item={detail} statuses={statusIndex.statuses} />

        <section className="detail-section">
          <div className="detail-section-head">
            <h2 className="detail-section-title">Timeline</h2>
            <span className="tertiary">{pluralize(detail.eventCount, 'entry', 'entries')}</span>
          </div>
          <AddEntry onAdd={(entry) => void store.addEvent(entry)} />
          <Timeline
            events={detail.timeline}
            now={now}
            onDeleteEvent={(eventId) => void store.deleteEvent(eventId)}
            onOpenMeeting={openExternal}
          />
        </section>

        {detail.messages.length > 0 ? (
          <section className="detail-section">
            <div className="detail-section-head">
              <h2 className="detail-section-title">Linked mail</h2>
              <span className="tertiary">{detail.messages.length}</span>
            </div>
            <List>
              {detail.messages.map((m) => (
                <div key={m.id} className="linked-mail-row">
                  <ListRow
                    lead={<Icon name="mail" size={12} />}
                    title={m.subject ?? '(no subject)'}
                    subtitle={m.fromName ?? m.fromAddr ?? 'Unknown sender'}
                    meta={formatListDate(m.dateUtc, now)}
                    onClick={onOpenMessage ? () => onOpenMessage(m.id) : undefined}
                  />
                  <IconButton
                    icon="x"
                    label="Unlink message"
                    onClick={() => void store.unlinkMessage(m.id)}
                  />
                </div>
              ))}
            </List>
          </section>
        ) : null}

        <section className="detail-section detail-danger">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void store.setArchived(detail.archivedAt === null)}
          >
            {detail.archivedAt ? 'Unarchive' : 'Archive'}
          </Button>
          {confirmDelete ? (
            <>
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                onClick={() => {
                  void store.remove().then(() => onBack?.())
                }}
              >
                Delete permanently
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </section>
      </div>
    </div>
  )
}

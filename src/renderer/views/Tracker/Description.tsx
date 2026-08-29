/**
 * The description block.
 *
 * When the agent wrote it, say so and say what editing means — the moment the user saves,
 * description_source flips to 'user' and enrichment stops overwriting it. That promise
 * is the whole reason the note exists, so it's stated in the note itself.
 */

import { useEffect, useState } from 'react'
import { Button, Icon, formatRelative } from '@renderer/components'
import type { JSX } from 'react'
import type { ItemDetail } from '@shared/types'
import { Markdown } from './Markdown'

export function Description({
  item,
  now,
  onSave
}: {
  item: ItemDetail
  now: number
  onSave: (markdown: string) => void | Promise<void>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.descriptionMd ?? '')
  const [saving, setSaving] = useState(false)

  // A background refresh (agent run, accepted proposal) must not clobber an open editor.
  useEffect(() => {
    if (!editing) setDraft(item.descriptionMd ?? '')
  }, [item.descriptionMd, item.id, editing])

  useEffect(() => {
    setEditing(false)
  }, [item.id])

  const byAgent = item.descriptionSource === 'agent'
  const hasText = (item.descriptionMd ?? '').trim().length > 0

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const cancel = (): void => {
    setDraft(item.descriptionMd ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <section className="detail-section description is-editing">
        <div className="detail-section-head">
          <h2 className="detail-section-title">Description</h2>
          <span className="tertiary">Markdown</span>
        </div>
        <textarea
          className="input description-editor"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
          }}
        />
        <div className="row">
          <Button variant="primary" size="sm" onClick={() => void save()} busy={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="subtle" onClick={cancel}>
            Cancel
          </Button>
          <span className="tertiary description-warn">
            {byAgent ? 'Saving marks this description as yours.' : '⌘↩ to save'}
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="detail-section description">
      <div className="detail-section-head">
        <h2 className="detail-section-title">Description</h2>
        {hasText ? (
          <Button size="sm" variant="subtle" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>

      {byAgent && hasText ? (
        <div className="description-note" title="Enrichment overwrites the agent's text, never yours">
          <Icon name="sparkle" size={11} />
          <span>
            written by Agent
            {item.descriptionUpdatedAt ? ` ${formatRelative(item.descriptionUpdatedAt, now)}` : ''} ·{' '}
            <button type="button" className="linklike" onClick={() => setEditing(true)}>
              edit to take ownership
            </button>
          </span>
        </div>
      ) : null}

      {hasText ? (
        <Markdown source={item.descriptionMd ?? ''} />
      ) : (
        <div className="description-empty tertiary">
          No description yet.{' '}
          <button type="button" className="linklike" onClick={() => setEditing(true)}>
            Write one
          </button>
          {' — or let enrichment fetch it (Settings).'}
        </div>
      )}
    </section>
  )
}

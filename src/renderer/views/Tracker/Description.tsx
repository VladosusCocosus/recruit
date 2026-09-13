/**
 * The description block, and the one place an enrich run can be started.
 *
 * Two promises are made here and both are load-bearing:
 *
 * 1. When the agent wrote it, say so and say what editing means — the moment the user
 *    saves, description_source flips to 'user' and enrichment stops overwriting it.
 * 2. Research does NOT change this text. An enrich run has no tracker tools, so its
 *    brief comes back as a proposal in the Review queue like everything else. Saying
 *    "filed in Review" is the difference between a working button and a broken one.
 */

import { useEffect, useState } from 'react'
import {
  Button,
  Icon,
  Markdown,
  formatRelative,
  useAgentRun,
  useSettings
} from '@renderer/components'
import type { JSX } from 'react'
import type { ItemDetail } from '@shared/types'

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
  const [filed, setFiled] = useState(false)
  /** Why the last enrich run from this block filed nothing. */
  const [runError, setRunError] = useState<string | null>(null)

  const { settings } = useSettings()
  const run = useAgentRun({ kind: 'enrich' })
  const enrichmentOn = settings?.enrichmentEnabled === true

  // A background refresh (agent run, accepted proposal) must not clobber an open editor.
  useEffect(() => {
    if (!editing) setDraft(item.descriptionMd ?? '')
  }, [item.descriptionMd, item.id, editing])

  useEffect(() => {
    setEditing(false)
    setFiled(false)
    setRunError(null)
  }, [item.id])

  const byAgent = item.descriptionSource === 'agent'
  const hasText = (item.descriptionMd ?? '').trim().length > 0
  const busy = run.busy
  const blockedByOtherRun = run.blockedReason !== null

  const research = async (): Promise<void> => {
    setFiled(false)
    setRunError(null)
    const outcome = await run.start({ company: item.company, itemId: item.id })
    setFiled(outcome.ok)
    setRunError(outcome.ok || outcome.stopped ? null : outcome.error)
  }

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
        {enrichmentOn ? (
          <Button
            size="sm"
            variant="subtle"
            icon="search"
            busy={busy}
            disabled={blockedByOtherRun}
            title={
              run.blockedReason ??
              `Search the web for a brief on ${item.company}. Comes back as a proposal in Review.`
            }
            onClick={() => void research()}
          >
            {busy ? 'Researching…' : hasText ? 'Re-research' : 'Research'}
          </Button>
        ) : null}
        {hasText ? (
          <Button size="sm" variant="subtle" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>

      {filed ? (
        <div className="description-note is-filed">
          <Icon name="review" size={11} />
          <span>Brief filed in Review — accept it to replace this description.</span>
        </div>
      ) : null}

      {runError ? (
        <div className="description-note is-error">
          <Icon name="alert" size={11} />
          <span>{runError}</span>
        </div>
      ) : null}

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
          {enrichmentOn ? (
            <>
              {' — or '}
              <button type="button" className="linklike" onClick={() => void research()} disabled={busy}>
                research it
              </button>
              {'.'}
            </>
          ) : (
            ' — or turn on enrichment in Settings and let the agent research it.'
          )}
        </div>
      )}
    </section>
  )
}

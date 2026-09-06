/**
 * The question cards and the composer that adds one. Presentational: every piece of
 * state, and the run itself, belongs to `useAnswers`.
 *
 * No section heading of its own — each mount sits in the chrome of the screen it is on,
 * the item inspector's `.detail-section` or the apply review's `.ap-section`.
 */

import { useEffect, useState } from 'react'
import {
  Button,
  Icon,
  IconButton,
  Spinner,
  formatElapsed,
  pluralize
} from '@renderer/components'
import type { JSX } from 'react'
import type { AnswerCard, AnswersStore } from './useAnswers'

const ADD_PLACEHOLDER = 'Paste a question from the form — "What do you like about this role?"'

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

export function Answers({
  store,
  disabled = false
}: {
  store: AnswersStore
  /** Locks every control, e.g. while the application is being filed. */
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="an">
      {store.error ? (
        <p className="an-error selectable" role="alert">
          <Icon name="alert" size={11} />
          {store.error}
          <button type="button" className="an-dismiss" onClick={store.clearError}>
            Dismiss
          </button>
        </p>
      ) : null}

      {store.loading ? (
        <p className="an-empty tertiary">Loading the questions…</p>
      ) : store.cards.length === 0 ? (
        <p className="an-empty tertiary">
          No questions yet. Paste one from the application form and draft an answer against
          this job.
        </p>
      ) : (
        <div className="an-list">
          {store.cards.map((card) => (
            <QuestionCard key={card.key} card={card} store={store} disabled={disabled} />
          ))}
        </div>
      )}

      <AddQuestion onAdd={store.add} disabled={disabled} />
    </div>
  )
}

/* ── one question ─────────────────────────────────────────────────────────── */

function QuestionCard({
  card,
  store,
  disabled
}: {
  card: AnswerCard
  store: AnswersStore
  disabled: boolean
}): JSX.Element {
  const [draft, setDraft] = useState(card.answerMd)

  useEffect(() => setDraft(card.answerMd), [card.answerMd])

  const commit = (): void => {
    if (draft !== card.answerMd) store.setAnswer(card.key, draft)
  }

  const cls =
    'an-card' + (card.drafting ? ' is-drafting' : '') + (card.error ? ' is-failed' : '')

  return (
    <div className={cls}>
      <div className="an-card-head">
        <p className="an-question selectable">{card.question}</p>
        <IconButton
          icon="x"
          label="Remove this question"
          disabled={disabled || card.drafting}
          onClick={() => store.remove(card.key)}
        />
      </div>

      <textarea
        className="input an-answer"
        value={draft}
        placeholder="Write the answer, or draft one and edit it."
        aria-label={`Answer to: ${card.question}`}
        disabled={disabled || card.drafting}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
      />

      <div className="an-card-foot">
        {card.drafting ? (
          <>
            <Spinner size={11} label="" />
            <span className="an-elapsed tabular">{formatElapsed(store.elapsedMs)}</span>
            <span className="tertiary">Drafting an answer…</span>
            <span className="an-spacer" />
            <Button size="sm" variant="outline" disabled={store.stopping} onClick={store.stop}>
              {store.stopping ? 'Stopping…' : 'Stop'}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="subtle"
              icon="sparkle"
              disabled={disabled || store.draftDisabledReason !== null}
              title={store.draftDisabledReason ?? undefined}
              onClick={() => store.draft(card.key)}
            >
              {card.answerMd.trim() === '' ? 'Draft an answer' : 'Draft again'}
            </Button>
            <span className="tertiary">{pluralize(countWords(draft), 'word')}</span>
            <span className="an-spacer" />
            {store.draftDisabledReason ? (
              <span className="an-blocked tertiary">{store.draftDisabledReason}</span>
            ) : null}
          </>
        )}
      </div>

      {card.error ? (
        <p className="an-card-error selectable" role="alert">
          <Icon name="alert" size={11} />
          {card.error}
        </p>
      ) : null}
    </div>
  )
}

/* ── the composer ─────────────────────────────────────────────────────────── */

function AddQuestion({
  onAdd,
  disabled
}: {
  onAdd: (question: string) => void
  disabled: boolean
}): JSX.Element {
  const [text, setText] = useState('')

  const submit = (): void => {
    if (text.trim() === '') return
    onAdd(text)
    setText('')
  }

  return (
    <div className="an-add">
      <textarea
        className="input an-add-input"
        value={text}
        placeholder={ADD_PLACEHOLDER}
        aria-label="A question from the application form"
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <div className="an-add-foot">
        <Button
          size="sm"
          variant="outline"
          icon="plus"
          disabled={disabled || text.trim() === ''}
          onClick={submit}
        >
          Add a question
        </Button>
        <span className="tertiary">⌘↩ to add</span>
      </div>
    </div>
  )
}

/**
 * The evidence behind a card: which emails the agent was allowed to read.
 *
 * Still never collapsed away — a proposal without visible provenance is just an assertion,
 * and the point of the review queue is that the user can check the work. What went is the
 * prefilter arithmetic that used to sit under each one: "FLAGGED 0.71 +0.45 subject looks
 * recruiting-related +0.26 sender is recruiter". Those weights answer "why did this email
 * get scanned", which is a different question from "why does the agent believe this", and
 * the Candidates list already answers it in the place where it is actionable. Here it was
 * three rows of debugging output between the reviewer and the decision.
 *
 * The score and the reasons are kept on the row's tooltip, so nothing is lost — it just
 * stops shouting.
 */

import { Icon, formatListDate, formatReasonCode, formatSender, formatScore, formatWeight } from '@renderer/components'
import type { JSX } from 'react'
import type { MessageSummary, PrefilterReason } from '@shared/types'

interface Props {
  messages: MessageSummary[]
  onOpenMessage?: (messageId: number) => void
}

function reasonText(reason: PrefilterReason): string {
  const base = formatReasonCode(reason.code)
  return reason.detail ? `${base} · ${reason.detail}` : base
}

/** The prefilter's whole case for this email, on one line, for the native tooltip. */
function whyTooltip(message: MessageSummary): string {
  const head = 'Open in Mail'
  if (message.prefilterScore == null && message.prefilterReasons.length === 0) return head
  const score = message.prefilterScore != null ? `flagged ${formatScore(message.prefilterScore)}` : 'flagged'
  const reasons = message.prefilterReasons.map((r) => `${formatWeight(r.weight)} ${reasonText(r)}`)
  return [head, [score, ...reasons].join('\n')].join('\n\n')
}

function Body({ message }: { message: MessageSummary }): JSX.Element {
  return (
    <>
      <span className="rq-source-icon">
        <Icon name="mail" size={12} />
      </span>
      <span className="rq-source-text truncate">
        <span className="rq-source-subject">{message.subject?.trim() || '(no subject)'}</span>
        <span className="rq-source-from"> — {formatSender(message.fromName, message.fromAddr)}</span>
      </span>
      <span className="rq-source-date tabular">{formatListDate(message.dateUtc)}</span>
    </>
  )
}

export function SourceMessages({ messages, onOpenMessage }: Props): JSX.Element | null {
  if (messages.length === 0) return null

  return (
    <ul className="rq-sources">
      {messages.map((m) => (
        <li key={m.id}>
          {onOpenMessage ? (
            <button
              type="button"
              className="rq-source is-clickable"
              title={whyTooltip(m)}
              onClick={() => onOpenMessage(m.id)}
            >
              <Body message={m} />
            </button>
          ) : (
            <div className="rq-source" title={whyTooltip(m)}>
              <Body message={m} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

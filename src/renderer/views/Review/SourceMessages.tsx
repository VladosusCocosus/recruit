import { Icon, formatListDate, formatReasonCode, formatSender, formatWeight } from '@renderer/components'
import type { MessageSummary, PrefilterReason } from '@shared/types'
import { ScorePill } from './ConfidenceMeter'

interface Props {
  messages: MessageSummary[]
  onOpenMessage?: (messageId: number) => void
}

function reasonText(reason: PrefilterReason): string {
  const base = formatReasonCode(reason.code)
  return reason.detail ? `${base} · ${reason.detail}` : base
}

function ReasonChip({ reason }: { reason: PrefilterReason }): JSX.Element {
  return (
    <span
      className={`rq-reason${reason.weight < 0 ? ' is-negative' : ''}`}
      title={`${reasonText(reason)} (${formatWeight(reason.weight)})`}
    >
      <span className="rq-reason-weight tabular">{formatWeight(reason.weight)}</span>
      <span className="rq-reason-label">{reasonText(reason)}</span>
    </span>
  )
}

function SourceBody({ message }: { message: MessageSummary }): JSX.Element {
  const hasWhy = message.prefilterReasons.length > 0 || message.prefilterScore != null

  return (
    <>
      <span className="rq-source-icon">
        <Icon name="mail" size={13} />
      </span>
      <span className="rq-source-main">
        <span className="rq-source-top">
          <span className="rq-source-subject truncate selectable">
            {message.subject?.trim() || '(no subject)'}
          </span>
          <span className="rq-source-date tabular">{formatListDate(message.dateUtc)}</span>
        </span>
        <span className="rq-source-from truncate selectable">
          {formatSender(message.fromName, message.fromAddr)}
        </span>
        {hasWhy ? (
          <span className="rq-source-reasons">
            <span className="rq-why">Flagged</span>
            <ScorePill score={message.prefilterScore} />
            {message.prefilterReasons.map((r, i) => (
              <ReasonChip reason={r} key={`${r.code}-${i}`} />
            ))}
          </span>
        ) : null}
      </span>
    </>
  )
}

/**
 * The evidence behind a proposal: which emails the agent was allowed to read, and the
 * prefilter reasons that put them in front of it.
 *
 * Deliberately never collapsed away. A proposal without visible provenance is just an
 * assertion, and the point of the review queue is that the user can check the work.
 */
export function SourceMessages({ messages, onOpenMessage }: Props): JSX.Element | null {
  if (messages.length === 0) return null

  return (
    <div className="rq-sources">
      <div className="rq-sources-label">
        {messages.length === 1 ? 'Source email' : `Source emails · ${messages.length}`}
      </div>
      <ul className="rq-source-list">
        {messages.map((m) => (
          <li key={m.id}>
            {onOpenMessage ? (
              <button
                type="button"
                className="rq-source is-clickable"
                onClick={() => onOpenMessage(m.id)}
                title="Open in Mail"
              >
                <SourceBody message={m} />
              </button>
            ) : (
              <div className="rq-source">
                <SourceBody message={m} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

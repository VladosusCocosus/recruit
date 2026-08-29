/**
 * One proposed change, as a row you can tick.
 *
 * Field rows read "before → after" whenever the prior value is known, because the question
 * a reviewer is actually asking is not "is this true?" but "is this better than what I
 * have?".
 *
 * The tick is the point of the row. Proposals that the agent tied together with a `ref`
 * have to be applied in order and cannot be split, so those rows carry no checkbox at all
 * rather than a disabled one — an unusable control is worse than none, and the absence is
 * what says "this one goes with the others".
 */

import { Icon } from '@renderer/components'
import type { JSX } from 'react'
import type { Proposal } from '@shared/types'
import type { DescribeContext, DiffLine } from './format'
import { PROPOSAL_ICON, describeProposal } from './format'
import { Confidence } from './Confidence'

interface Props {
  proposal: Proposal
  ctx: DescribeContext
  /** Ticked rows are what Accept and Reject act on. */
  checked: boolean
  /** Omit for a row that cannot be picked apart from its siblings. */
  onToggle?: (proposalId: number, checked: boolean) => void
  disabled?: boolean
  onOpenUrl?: (url: string) => void
}

const URL_LABELS = new Set(['Job URL', 'Meeting'])

function DiffValue({
  line,
  onOpenUrl
}: {
  line: DiffLine
  onOpenUrl?: (url: string) => void
}): JSX.Element {
  const value = line.to
  if (value == null) return <span className="rq-diff-empty">cleared</span>

  if (URL_LABELS.has(line.label) && /^https?:\/\//i.test(value) && onOpenUrl) {
    return (
      <button
        type="button"
        className="rq-linkish truncate selectable"
        onClick={() => onOpenUrl(value)}
        title={value}
      >
        {value}
      </button>
    )
  }
  return <span className="selectable">{value}</span>
}

export function ProposalDiff({
  proposal,
  ctx,
  checked,
  onToggle,
  disabled,
  onOpenUrl
}: Props): JSX.Element {
  const description = describeProposal(proposal, ctx)
  const statusKey =
    proposal.kind === 'set_status'
      ? proposal.payload.status_key
      : proposal.kind === 'create_item'
        ? proposal.payload.status_key
        : undefined
  const accent = statusKey ? (ctx.statuses.get(statusKey)?.color ?? null) : null

  return (
    <div className={'rq-change' + (onToggle && !checked ? ' is-skipped' : '')}>
      <div className="rq-change-head">
        {onToggle ? (
          <input
            type="checkbox"
            className="rq-tick"
            checked={checked}
            disabled={disabled}
            aria-label={description.headline}
            onChange={(e) => onToggle(proposal.id, e.currentTarget.checked)}
          />
        ) : (
          /* Locked to its siblings. The icon takes the gutter so every row on the card
             still lines up at the same left edge. */
          <span className="rq-tick-locked" aria-hidden="true" />
        )}
        <span className="rq-change-icon" style={accent ? { color: accent } : undefined}>
          <Icon name={PROPOSAL_ICON[proposal.kind]} size={13} />
        </span>
        <span className="rq-change-headline selectable">{description.headline}</span>
        <Confidence value={proposal.confidence} />
      </div>

      {description.lines.length > 0 ? (
        <dl className="rq-diff-lines">
          {description.lines.map((line, i) => (
            <div className={`rq-diff-line is-${line.tone}`} key={`${line.label}-${i}`}>
              <dt className="rq-diff-label">{line.label}</dt>
              <dd className="rq-diff-value">
                {line.from != null ? (
                  <>
                    <span className="rq-diff-from selectable">{line.from}</span>
                    <span className="rq-diff-arrow">
                      <Icon name="chevronRight" size={11} />
                    </span>
                  </>
                ) : null}
                <DiffValue line={line} onOpenUrl={onOpenUrl} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {proposal.rationale ? <p className="rq-rationale selectable">{proposal.rationale}</p> : null}
    </div>
  )
}

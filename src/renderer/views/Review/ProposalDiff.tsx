import { Icon } from '@renderer/components'
import type { Proposal } from '@shared/types'
import type { DescribeContext, DiffLine } from './format'
import { PROPOSAL_ICON, describeProposal } from './format'
import { ConfidenceMeter } from './ConfidenceMeter'

interface Props {
  proposal: Proposal
  ctx: DescribeContext
  /** Show the per-proposal confidence pill — only worth it inside a bundle. */
  showConfidence: boolean
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
        className="rq-linkish selectable"
        onClick={() => onOpenUrl(value)}
        title={value}
      >
        {value}
      </button>
    )
  }
  return <span className="selectable">{value}</span>
}

/**
 * One proposal rendered as "what will change".
 *
 * Field rows read "before → after" whenever we know the prior value, because the question a
 * reviewer is actually asking is not "is this true?" but "is this better than what I have?".
 */
export function ProposalDiff({ proposal, ctx, showConfidence, onOpenUrl }: Props): JSX.Element {
  const description = describeProposal(proposal, ctx)
  const statusKey =
    proposal.kind === 'set_status'
      ? proposal.payload.status_key
      : proposal.kind === 'create_item'
        ? proposal.payload.status_key
        : undefined
  const accent = statusKey ? (ctx.statuses.get(statusKey)?.color ?? null) : null

  return (
    <div className="rq-diff">
      <div className="rq-diff-head">
        <span className="rq-diff-icon" style={accent ? { color: accent } : undefined}>
          <Icon name={PROPOSAL_ICON[proposal.kind]} size={13} />
        </span>
        <span className="rq-diff-headline selectable">{description.headline}</span>
        {showConfidence ? <ConfidenceMeter value={proposal.confidence} compact /> : null}
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

      {proposal.rationale ? (
        <p className="rq-rationale selectable">
          <span className="rq-rationale-mark">Why</span>
          {proposal.rationale}
        </p>
      ) : null}
    </div>
  )
}

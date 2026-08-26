/**
 * "Why was this flagged?" — the prefilter's reasons, surfaced on every candidate.
 *
 * The brief makes this non-optional: the same reasons reappear on the proposal cards in the
 * Review queue, so a user can always trace an agent proposal back to the signal that put the
 * message in front of the agent in the first place.
 */

import type { PrefilterReason } from '@shared/types'
import { BoltIcon } from './icons'
import { formatScore, reasonDetailLabel, reasonLabel, reasonsSummary } from './format'

export interface WhyFlaggedProps {
  reasons: PrefilterReason[]
  score: number | null
  /** 'row' = one truncated line in the list. 'reader' = chips with the matched detail. */
  variant?: 'row' | 'reader'
}

export function WhyFlagged({
  reasons,
  score,
  variant = 'row'
}: WhyFlaggedProps): JSX.Element | null {
  if (reasons.length === 0) return null

  const tooltip = `Score ${formatScore(score)}\n${reasons.map(reasonDetailLabel).join('\n')}`

  if (variant === 'row') {
    return (
      <span className="mail-why truncate" title={tooltip}>
        <BoltIcon size={10} className="mail-why-bolt" />
        <span className="truncate">{reasonsSummary(reasons)}</span>
        <span className="mail-why-score tabular">{formatScore(score)}</span>
      </span>
    )
  }

  return (
    <div className="mail-why-reader">
      <span className="mail-why-label" title={tooltip}>
        <BoltIcon size={11} className="mail-why-bolt" />
        Why flagged
      </span>
      {reasons.map((reason, index) => (
        <span
          key={`${reason.code}-${index}`}
          className={reason.weight < 0 ? 'chip mail-reason is-negative' : 'chip mail-reason'}
          title={reasonDetailLabel(reason)}
        >
          {reasonLabel(reason)}
          {reason.detail ? <span className="mail-reason-detail">{reason.detail}</span> : null}
        </span>
      ))}
      <span className="mail-why-score tabular" title="Prefilter score">
        {formatScore(score)}
      </span>
    </div>
  )
}

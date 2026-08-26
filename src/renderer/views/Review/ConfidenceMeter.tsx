import { formatConfidence, formatScore } from '@renderer/components'

interface Props {
  /** 0..1, or null when the agent declined to score itself. */
  value: number | null
  /** Compact form for inline use on a diff row. */
  compact?: boolean
  label?: string
}

function tone(value: number): 'low' | 'mid' | 'high' {
  if (value >= 0.8) return 'high'
  if (value >= 0.5) return 'mid'
  return 'low'
}

/**
 * The agent's self-reported confidence.
 *
 * Deliberately understated: a filled bar is not a verdict, and low confidence is coloured as
 * a caution rather than an error — the agent being unsure is useful information, not a fault.
 */
export function ConfidenceMeter({
  value,
  compact = false,
  label = 'Confidence'
}: Props): JSX.Element {
  if (value == null) {
    return <span className="rq-confidence rq-confidence--unknown">no confidence</span>
  }
  const clamped = Math.max(0, Math.min(1, value))
  const pct = Math.round(clamped * 100)

  if (compact) {
    return (
      <span
        className={`rq-confidence rq-confidence--compact rq-confidence--${tone(clamped)}`}
        title={`${label} ${pct}%`}
      >
        {formatConfidence(clamped)}
      </span>
    )
  }

  return (
    <div className={`rq-confidence rq-confidence--${tone(clamped)}`} title={`${label} ${pct}%`}>
      <span className="rq-confidence-label">{label}</span>
      <span className="rq-confidence-track" role="img" aria-label={`${label} ${pct} percent`}>
        <span className="rq-confidence-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="rq-confidence-value">{formatConfidence(clamped)}</span>
    </div>
  )
}

/** The prefilter's own score, shown next to the reasons that produced it. */
export function ScorePill({ score }: { score: number | null }): JSX.Element | null {
  if (score == null) return null
  return (
    <span className="rq-score-pill" title="Prefilter score">
      {formatScore(score)}
    </span>
  )
}

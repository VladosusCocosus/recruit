/**
 * The agent's self-reported confidence — shown only when it is low enough to matter.
 *
 * This replaced a labelled meter bar that appeared on every proposal and again on every
 * card, so a 97% offer and a 34% guess arrived carrying the same amount of chrome. A bar
 * that is nearly always full is not a signal, it is a decoration with a number in it, and
 * it spent the reviewer's attention on the cases that least needed it.
 *
 * So the rule is the one the board and the rail already use: say nothing when there is
 * nothing to say. Above the threshold, and when the agent declined to score itself at all,
 * this renders nothing — a confident proposal is the ordinary case and the card is already
 * showing you what it will do. Below it, one quiet caution with the figure attached.
 *
 * The figure is kept because "the agent is unsure" and "the agent is very unsure" are
 * different decisions, but it is deliberately not turned into a gradient of colours: there
 * is one tone, and it means look closer.
 */

import type { JSX } from 'react'

/** At or above this the agent is not telling you anything you need to act on. */
export const SURE_ENOUGH = 0.8

export function Confidence({
  value,
  summary
}: {
  value: number | null
  /**
   * Card level. Renders the word without the figure, because the figure is already on
   * the row it came from — the card only has to say "something below needs a look".
   */
  summary?: boolean
}): JSX.Element | null {
  if (value == null || value >= SURE_ENOUGH) return null
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <span
      className="rq-unsure"
      title={`The agent rated itself ${pct}% confident in this`}
    >
      {summary ? 'Unsure' : `${pct}%`}
    </span>
  )
}

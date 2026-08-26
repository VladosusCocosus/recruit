import type { AgentRunUpdate } from '@shared/types'
import { Icon, Spinner } from './Icon'
import { Badge } from './Badge'
import { formatElapsed, formatToolName } from './format'

/**
 * THE RUN BUTTON — the signature control of the app.
 *
 * Idle:    [▶ Run · 7]      26px tall, 12px text, outline, play glyph, count pill.
 * Active:  [◌ 12s  list_messages ✕]   the SAME element, morphed in place.
 *
 * How "no layout shift" is achieved: the outer .run-control is the last flex item
 * in the toolbar and carries `margin-left:auto`, so its RIGHT edge is pinned to the
 * toolbar's right padding. When the live status makes it wider it grows leftward
 * into the draggable spacer — nothing before it moves, and the edge the eye is
 * anchored on never shifts. Elapsed seconds render in tabular numerals and the
 * tool name is width-capped with an ellipsis, so neither can jitter the width as
 * they change. There is no modal, no popover, and no second control anywhere.
 */

export interface RunButtonProps {
  /** Non-null while a run is in flight. Null renders the idle button. */
  active: AgentRunUpdate | null
  /** Pill count: messages currently sitting in triage_state='candidate'. */
  candidateCount: number
  elapsedMs: number
  onStart: () => void
  onStop: () => void
  /** Claude CLI missing / not signed in — the button explains itself instead of failing. */
  disabledReason?: string | null
}

export function RunButton({
  active,
  candidateCount,
  elapsedMs,
  onStart,
  onStop,
  disabledReason
}: RunButtonProps): JSX.Element {
  if (active) {
    const tool = formatToolName(active.currentTool)
    const starting = active.state === 'starting'
    const label = starting ? 'Starting…' : tool || 'Thinking…'
    return (
      <div
        className="run-control is-active"
        role="status"
        aria-live="polite"
        aria-label={`Run in progress, ${formatElapsed(elapsedMs)} elapsed${
          tool ? `, ${tool}` : ''
        }`}
      >
        <span className="run-status">
          <span className="run-spinner">
            <Spinner size={12} label="" />
          </span>
          <span className="run-elapsed tabular">{formatElapsed(elapsedMs)}</span>
          <span className="run-sep">·</span>
          <span className="run-tool" title={active.currentTool ?? label}>
            {label}
          </span>
          {active.proposalCount > 0 ? (
            <Badge tone="accent-soft" title={`${active.proposalCount} proposals so far`}>
              {active.proposalCount}
            </Badge>
          ) : null}
        </span>
        <button
          type="button"
          className="run-stop"
          onClick={onStop}
          disabled={starting}
          aria-label="Stop run"
          title="Stop run"
        >
          <Icon name="stop" size={11} />
        </button>
      </div>
    )
  }

  const nothingToDo = candidateCount === 0
  const reason =
    disabledReason ?? (nothingToDo ? 'No candidate messages to scan yet' : null)

  return (
    <div className="run-control">
      <button
        type="button"
        className="run-trigger"
        onClick={onStart}
        disabled={reason !== null}
        title={reason ?? `Scan ${candidateCount} candidate messages with Claude`}
      >
        <span className="run-trigger-icon">
          <Icon name="play" size={11} />
        </span>
        Run
        {candidateCount > 0 ? (
          <>
            <span className="run-sep">·</span>
            <span className="run-count">
              <Badge tone="accent-soft">{candidateCount}</Badge>
            </span>
          </>
        ) : null}
      </button>
    </div>
  )
}

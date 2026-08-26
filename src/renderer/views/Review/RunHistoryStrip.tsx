import { Icon, formatCost, formatDuration, formatRelative, pluralize } from '@renderer/components'
import type { AgentErrorKind, AgentRunSummary } from '@shared/types'

interface Props {
  runs: AgentRunSummary[]
  selectedRunId: number | null
  onSelect: (runId: number | null) => void
}

const ERROR_LABEL: Record<AgentErrorKind, string> = {
  not_signed_in: 'not signed in',
  cli_missing: 'CLI missing',
  spawn_failed: 'spawn failed',
  timeout: 'timed out',
  stopped: 'stopped',
  bad_output: 'bad output',
  unknown: 'failed'
}

function runOutcome(run: AgentRunSummary): string {
  if (run.isError) return ERROR_LABEL[run.errorKind ?? 'unknown']
  if (!run.finishedAt) return 'running'
  return run.proposalCount === 0 ? 'no proposals' : pluralize(run.proposalCount, 'proposal')
}

/**
 * What the agent has been doing lately.
 *
 * Runs that produced nothing stay visible: "it ran and found nothing" and "it never ran"
 * must not look the same, or a silent failure reads as a quiet inbox.
 */
export function RunHistoryStrip({ runs, selectedRunId, onSelect }: Props): JSX.Element | null {
  if (runs.length === 0) return null

  return (
    <div className="rq-runs" role="group" aria-label="Recent agent runs">
      <div className="rq-runs-label">Runs</div>
      <div className="rq-runs-scroll">
        {selectedRunId != null ? (
          <button type="button" className="rq-run is-clear" onClick={() => onSelect(null)}>
            Show all
          </button>
        ) : null}
        {runs.map((run) => {
          const selected = run.id === selectedRunId
          const duration = formatDuration(run.durationMs)
          const cost = formatCost(run.costUsd)
          return (
            <button
              type="button"
              key={run.id}
              className={[
                'rq-run',
                selected ? 'is-selected' : '',
                run.isError ? 'is-error' : '',
                run.kind === 'enrich' ? 'is-enrich' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(selected ? null : run.id)}
              title={run.errorText ?? `${run.kind} run #${run.id}${run.model ? ` · ${run.model}` : ''}`}
            >
              <span className="rq-run-icon">
                <Icon
                  name={run.isError ? 'alert' : run.finishedAt ? 'checkCircle' : 'clock'}
                  size={12}
                />
              </span>
              <span className="rq-run-main">
                <span className="rq-run-top">
                  <span className="rq-run-kind">{run.kind}</span>
                  <span className="rq-run-when tabular">{formatRelative(run.startedAt)}</span>
                </span>
                <span className="rq-run-sub truncate">{runOutcome(run)}</span>
                <span className="rq-run-meta tabular">
                  {run.model ? <span>{run.model}</span> : null}
                  {duration ? <span>{duration}</span> : null}
                  {cost ? <span>{cost}</span> : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * What the tailor run wants to change, as rows you can untick.
 *
 * The visual grammar is the review queue's: a tick in the gutter, the prior text struck
 * through and receding, the new text after it, the reason underneath, and an unticked row
 * left readable rather than hidden. It carries the same `is-add` / `is-remove` /
 * `is-change` vocabulary, and a change with no `before` reads as an insertion. The tone
 * word is chrome — the resulting document carries only the text.
 */

import { Button, Icon } from '@renderer/components'
import type { JSX } from 'react'
import type { TailorChange } from '@shared/types'

type ChangeTone = 'add' | 'remove' | 'change'

const TONE_LABEL: Record<ChangeTone, string> = {
  add: 'Added',
  remove: 'Removed',
  change: 'Changed'
}

/** An empty `before` is an insertion; an empty `after` is a deletion. */
function changeTone(change: TailorChange): ChangeTone {
  if (change.before.trim() === '') return 'add'
  if (change.after.trim() === '') return 'remove'
  return 'change'
}

interface Props {
  changes: TailorChange[]
  rejected: ReadonlySet<number>
  onToggle: (index: number, accepted: boolean) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  disabled?: boolean
}

export function ChangeList({
  changes,
  rejected,
  onToggle,
  onAcceptAll,
  onRejectAll,
  disabled = false
}: Props): JSX.Element {
  const total = changes.length
  const acceptedCount = total - rejected.size

  return (
    <section className="ap-section">
      <div className="ap-section-head">
        <h3 className="ap-section-title">Changes</h3>
        {total > 0 ? (
          <span className="ap-section-note tertiary tabular">
            {acceptedCount} of {total} accepted
          </span>
        ) : null}
        <span className="ap-spacer" />
        {total > 0 ? (
          <>
            <Button
              size="sm"
              variant="subtle"
              disabled={disabled || acceptedCount === total}
              onClick={onAcceptAll}
            >
              Accept all
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={disabled || acceptedCount === 0}
              onClick={onRejectAll}
            >
              Reject all
            </Button>
          </>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="ap-note tertiary">
          The run proposed no edits — it read your resume as already matching this job.
        </p>
      ) : (
        <div className="ap-changes">
          {changes.map((change, index) => {
            const tone = changeTone(change)
            const accepted = !rejected.has(index)
            return (
              <div
                className={`ap-change is-${tone}` + (accepted ? '' : ' is-skipped')}
                key={`${change.section}-${index}`}
              >
                <div className="ap-change-head">
                  <input
                    type="checkbox"
                    className="ap-tick"
                    checked={accepted}
                    disabled={disabled}
                    aria-label={`${TONE_LABEL[tone]} in ${change.section}`}
                    onChange={(e) => onToggle(index, e.currentTarget.checked)}
                  />
                  <span className="ap-change-section selectable">{change.section}</span>
                  <span className="ap-change-tone">{TONE_LABEL[tone]}</span>
                </div>

                <div className="ap-change-body">
                  {change.before.trim() !== '' ? (
                    <span className="ap-change-before selectable">{change.before}</span>
                  ) : null}
                  {change.before.trim() !== '' && change.after.trim() !== '' ? (
                    <span className="ap-change-arrow">
                      <Icon name="chevronRight" size={11} />
                    </span>
                  ) : null}
                  {change.after.trim() !== '' ? (
                    <span className="ap-change-after selectable">{change.after}</span>
                  ) : (
                    <span className="ap-change-empty">removed</span>
                  )}
                </div>

                {change.reason ? (
                  <p className="ap-change-reason selectable">{change.reason}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

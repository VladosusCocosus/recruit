/**
 * One row in the mail list.
 *
 * NOT the shared <ListRow>: that primitive renders a <button>, and this row carries a nested
 * "Run on this message" button. A button inside a button is invalid HTML — React renders it
 * and the browser then mis-handles the click. So this is a div with role="option" plus its
 * own keyboard handling, reusing the exact .list-row-* classes so it stays visually identical
 * to every other list in the app.
 */

import { memo, type KeyboardEvent } from 'react'
import type { MessageSummary } from '@shared/types'
import { Badge, Button, Chip, Dot, Icon } from '@renderer/components'
import { PaperclipIcon } from './icons'
import { WhyFlagged } from './WhyFlagged'
import { formatListDate, senderLabel, subjectLabel, triageLabel } from './format'

export interface MessageRowProps {
  message: MessageSummary
  selected: boolean
  onSelect: (messageId: number) => void
  /** Right-click. The list mounts one menu for every row and anchors it at the pointer. */
  onContextMenu: (message: MessageSummary, e: { clientX: number; clientY: number }) => void
  /** The open menu belongs to this row — see `.list-row.is-menu-target`. */
  menuOpen: boolean
  /** Starts a single-message triage run. Omit to hide the inline action entirely. */
  onRun?: (messageId: number) => void
  /** A run is already in flight — the inline action is disabled app-wide, not per row. */
  runDisabled: boolean
  /** This row is the one that started the in-flight run. */
  running: boolean
  /** Show the prefilter reasons line. On in the Candidates list. */
  showWhy: boolean
}

function MessageRowImpl({
  message,
  selected,
  onSelect,
  onContextMenu,
  menuOpen,
  onRun,
  runDisabled,
  running,
  showWhy
}: MessageRowProps): JSX.Element {
  const isCandidate = message.triageState === 'candidate'
  const linkedCount = message.linkedItemIds.length
  const dismissed = message.triageState === 'dismissed'

  const showRun = isCandidate && Boolean(onRun)

  const classes = ['list-row', 'mail-row']
  // Reserves the gutter the floating Run action sits in, so it never lands on the
  // "why flagged" line. Reserved always, not on hover, or the text reflows under the cursor.
  if (showRun) classes.push('has-run-action')
  if (selected) classes.push('is-selected')
  if (menuOpen) classes.push('is-menu-target')
  if (message.isUnread) classes.push('is-unread')
  if (dismissed) classes.push('is-dismissed')

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(message.id)
    }
  }

  const hasTags = message.hasAttachments || linkedCount > 0 || dismissed

  return (
    <div
      className={classes.join(' ')}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-message-focus={message.id}
      onClick={() => onSelect(message.id)}
      onKeyDown={onKeyDown}
      /* Right-click acts on the row without selecting it — selecting would start the
         dwell timer that marks a message read, which is not what someone reaching for
         "Mark as unread" or "Delete" asked for. */
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(message, e)
      }}
    >
      <span className="list-row-lead">{message.isUnread ? <Dot unread /> : null}</span>

      <span className="list-row-main">
        <span className="list-row-top">
          <span className="list-row-title">{senderLabel(message)}</span>
          <span className="list-row-meta">{formatListDate(message.dateUtc)}</span>
        </span>

        <span className="list-row-subtitle">{subjectLabel(message.subject)}</span>

        {message.snippet ? <span className="list-row-snippet">{message.snippet}</span> : null}

        {hasTags ? (
          <span className="list-row-tags">
            {message.hasAttachments ? (
              <Chip title="Has attachments">
                <PaperclipIcon size={10} />
                Attachment
              </Chip>
            ) : null}
            {linkedCount > 0 ? (
              <Badge tone="success" title="Linked to a tracker item">
                <Icon name="link" size={9} />
                {linkedCount > 1 ? ` ${linkedCount}` : ''}
              </Badge>
            ) : null}
            {dismissed ? (
              <Chip title="Dismissed — excluded from agent runs">
                {triageLabel(message.triageState)}
              </Chip>
            ) : null}
          </span>
        ) : null}

        {showWhy ? (
          <WhyFlagged reasons={message.prefilterReasons} score={message.prefilterScore} />
        ) : null}
      </span>

      {showRun && onRun ? (
        <span className={running ? 'mail-row-actions is-busy' : 'mail-row-actions'}>
          <Button
            size="sm"
            variant="outline"
            icon="play"
            busy={running}
            disabled={runDisabled}
            title={
              runDisabled && !running
                ? 'A run is already in progress'
                : 'Run triage on this message only'
            }
            onClick={(e) => {
              // The row itself is the click target for selection — don't also select.
              e.stopPropagation()
              onRun(message.id)
            }}
          >
            Run
          </Button>
        </span>
      ) : null}
    </div>
  )
}

export const MessageRow = memo(MessageRowImpl)

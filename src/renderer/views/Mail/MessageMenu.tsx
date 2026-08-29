/**
 * The contextual menu for one message in the mail list.
 *
 * The list had none at all: everything you could do to a message lived in the reading
 * pane's button row, so acting on a message you were not reading meant selecting it
 * first — which marks it read, exactly the thing you may have right-clicked to undo.
 * That is the reason this menu exists, and the reason opening it does NOT select the
 * row: the surface marks the row with `is-menu-target` instead, and nothing about the
 * message changes until you pick something.
 *
 * The rows mirror the reader's own actions and its exact wording, so the two places you
 * can dismiss a message do not describe it differently. Grouped by what they touch: how
 * you have read it, what the agent should make of it, what you want on the clipboard,
 * and finally the one that takes it away.
 */

import type { JSX } from 'react'
import type { MessageSummary, TriageState } from '@shared/types'
import { Menu, anchorFromEvent, copyText } from '@renderer/components'
import type { MenuAnchor, MenuNodeList } from '@renderer/components'
import { senderLabel, subjectLabel } from './format'

export interface MessageMenuTarget {
  message: MessageSummary
  anchor: MenuAnchor
}

export function messageMenuTargetFromEvent(
  message: MessageSummary,
  e: { clientX: number; clientY: number }
): MessageMenuTarget {
  return { message, anchor: anchorFromEvent(e) }
}

export interface MessageMenuActions {
  onOpen: (messageId: number) => void
  onMarkRead: (messageId: number, read: boolean) => void
  onTriage: (messageId: number, state: TriageState) => void
  onDelete: (messageId: number) => void
  onRun: (messageId: number) => void
  /** A run is already in flight — every surface's run action is disabled together. */
  runDisabled: boolean
  /** Follow the link to the tracker. Omit where the shell cannot route there. */
  onOpenItem?: (itemId: number) => void
}

function messageMenuItems(message: MessageSummary, actions: MessageMenuActions): MenuNodeList {
  const isCandidate = message.triageState === 'candidate'
  const dismissed = message.triageState === 'dismissed'
  // One linked item can be named and opened; several cannot. `linkedItemIds` carries ids
  // and nothing else, so a submenu here would offer "Application 12" and "Application 31".
  const linkedItemId = message.linkedItemIds.length === 1 ? message.linkedItemIds[0] : undefined
  // Narrowed once here: both are nullable, and a menu row that copies "null" is worse
  // than no row at all.
  const fromAddr = message.fromAddr
  const subject = message.subject

  return [
    {
      kind: 'action',
      id: 'open',
      label: 'Open',
      // Real: the row answers Enter and Space.
      shortcut: '⏎',
      onSelect: () => actions.onOpen(message.id)
    },
    linkedItemId !== undefined &&
      actions.onOpenItem && {
        kind: 'action' as const,
        id: 'show-in-tracker',
        label: 'Show in tracker',
        onSelect: () => actions.onOpenItem?.(linkedItemId)
      },

    { kind: 'separator', id: 'sep-read' },
    {
      kind: 'action',
      id: 'read',
      label: message.isUnread ? 'Mark as read' : 'Mark as unread',
      onSelect: () => actions.onMarkRead(message.id, message.isUnread)
    },

    { kind: 'separator', id: 'sep-triage' },
    isCandidate
      ? {
          kind: 'action' as const,
          id: 'run',
          label: 'Run triage on this message',
          disabled: actions.runDisabled,
          onSelect: () => actions.onRun(message.id)
        }
      : {
          kind: 'action' as const,
          id: 'flag',
          label: 'Flag as candidate',
          onSelect: () => actions.onTriage(message.id, 'candidate')
        },
    dismissed
      ? {
          kind: 'action' as const,
          id: 'undismiss',
          label: 'Undismiss',
          onSelect: () => actions.onTriage(message.id, 'unseen')
        }
      : {
          kind: 'action' as const,
          id: 'dismiss',
          label: 'Dismiss',
          onSelect: () => actions.onTriage(message.id, 'dismissed')
        },

    { kind: 'separator', id: 'sep-copy' },
    fromAddr
      ? {
          kind: 'action' as const,
          id: 'copy-from',
          label: 'Copy sender address',
          onSelect: () => void copyText(fromAddr)
        }
      : null,
    subject
      ? {
          kind: 'action' as const,
          id: 'copy-subject',
          label: 'Copy subject',
          onSelect: () => void copyText(subject)
        }
      : null,

    { kind: 'separator', id: 'sep-delete' },
    {
      kind: 'action',
      id: 'delete',
      label: 'Delete',
      // Red, but no ellipsis and no confirmation: the delete is local and the banner it
      // raises offers undo. Same call the reader's Delete button makes.
      danger: true,
      onSelect: () => actions.onDelete(message.id)
    }
  ]
}

export function MessageMenu({
  target,
  actions,
  onClose
}: {
  target: MessageMenuTarget
  actions: MessageMenuActions
  onClose: () => void
}): JSX.Element {
  const { message } = target
  return (
    <Menu
      anchor={target.anchor}
      items={messageMenuItems(message, actions)}
      label={`${senderLabel(message)} — ${subjectLabel(message.subject)}`}
      // The row survives most of these actions, but dismissing one can drop it out of
      // the Candidates filter and remount the list around it. Deleting removes it for
      // good, and then there is nothing to return to — focus falls back to the document,
      // which is the honest answer when the object you were acting on is gone.
      returnFocusTo={`[data-message-focus="${message.id}"]`}
      onClose={onClose}
    />
  )
}

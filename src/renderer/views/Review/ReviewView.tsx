import { useCallback } from 'react'
import type { ViewProps } from '@renderer/App'
import { ReviewQueue } from './ReviewQueue'

export interface ReviewViewProps extends ViewProps {
  /**
   * Override where a source-message / item link goes. By default `navigate` carries the id
   * in the hash and the destination view opens that row, which is what the shell wants;
   * these exist for embedding the queue somewhere that owns its own selection.
   */
  onOpenMessage?: (messageId: number) => void
  onOpenItem?: (itemId: number) => void
  /** Start a triage run. Defaults to sending the user to the toolbar's RUN button. */
  onRequestRun?: () => void
}

/**
 * Registry entry for NavKey 'review'. Everything real lives in ReviewQueue; this only
 * adapts the shell's ViewProps to it.
 */
export default function ReviewView({
  navigate,
  onOpenMessage,
  onOpenItem,
  onRequestRun
}: ReviewViewProps): JSX.Element {
  const openMessage = useCallback(
    (messageId: number) => {
      if (onOpenMessage) onOpenMessage(messageId)
      // Candidates, because that is the list a proposal's source message came from — and the
      // reader opens by id anyway, so one that has since been triaged out still shows.
      else navigate('candidates', { message: messageId })
    },
    [navigate, onOpenMessage]
  )

  const openItem = useCallback(
    (itemId: number) => {
      if (onOpenItem) onOpenItem(itemId)
      else navigate('board', { item: itemId })
    },
    [navigate, onOpenItem]
  )

  return (
    <ReviewQueue
      onOpenMessage={openMessage}
      onOpenItem={openItem}
      onRequestRun={onRequestRun}
    />
  )
}

export { ReviewView }

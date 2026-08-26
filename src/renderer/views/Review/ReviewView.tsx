import { useCallback } from 'react'
import type { ViewProps } from '@renderer/App'
import { ReviewQueue } from './ReviewQueue'

export interface ReviewViewProps extends ViewProps {
  /**
   * Deep-link to one message / item. The shell's `navigate` only carries a NavKey, so by
   * default we land the user on the right view and stop there. Pass these once a row-level
   * selection channel exists and the cards become click-through.
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
      else navigate('candidates')
    },
    [navigate, onOpenMessage]
  )

  const openItem = useCallback(
    (itemId: number) => {
      if (onOpenItem) onOpenItem(itemId)
      else navigate('board')
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

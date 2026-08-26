import { useCallback } from 'react'
import type { ViewProps } from '@renderer/App'
import { UpNext } from './UpNext'

export interface UpNextViewProps extends ViewProps {
  /**
   * Deep-link to one item. The shell's `navigate` only carries a NavKey, so by default a row
   * lands the user on the Board. Pass this once a row-level selection channel exists.
   */
  onOpenItem?: (itemId: number) => void
  limit?: number
}

/**
 * Registry entry for NavKey 'upnext'. Everything real lives in UpNext; this only adapts the
 * shell's ViewProps to it.
 */
export default function UpNextView({ navigate, onOpenItem, limit }: UpNextViewProps): JSX.Element {
  const openItem = useCallback(
    (itemId: number) => {
      if (onOpenItem) onOpenItem(itemId)
      else navigate('board')
    },
    [navigate, onOpenItem]
  )

  return <UpNext onOpenItem={openItem} limit={limit} />
}

export { UpNextView }

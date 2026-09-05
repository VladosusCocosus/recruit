import { useCallback } from 'react'
import type { ViewProps } from '@renderer/App'
import { UpNext } from './UpNext'

export interface UpNextViewProps extends ViewProps {
  /**
   * Override where a row goes. By default `navigate` carries the id in the hash and the
   * Board opens that item; this exists for embedding the list somewhere that owns its own
   * selection.
   */
  onOpenItem?: (itemId: number) => void
  limit?: number
}

/**
 * Registry entry for NavKey 'upnext'. Everything real lives in UpNext; this only adapts the
 * shell's ViewProps to it.
 */
export default function UpNextView({
  navigate,
  onOpenItem,
  limit,
  pendingDebriefs,
  openDebrief
}: UpNextViewProps): JSX.Element {
  const openItem = useCallback(
    (itemId: number) => {
      if (onOpenItem) onOpenItem(itemId)
      else navigate('board', { item: itemId })
    },
    [navigate, onOpenItem]
  )

  return (
    <UpNext
      onOpenItem={openItem}
      limit={limit}
      pendingDebriefs={pendingDebriefs}
      onOpenDebrief={openDebrief}
    />
  )
}

export { UpNextView }

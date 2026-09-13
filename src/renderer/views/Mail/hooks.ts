/** Small shared hooks for the Mail views. */

import { useEffect, useState } from 'react'

/**
 * AppSettings.blockRemoteImages — the *default* for a freshly opened message. The reader
 * still keeps a per-message override behind the "Load remote images" bar.
 */
export function useBlockRemoteImages(): boolean {
  const [block, setBlock] = useState(true)

  useEffect(() => {
    let alive = true
    window.recruit
      .getSettings()
      .then((settings) => {
        if (alive) setBlock(settings.blockRemoteImages)
      })
      .catch(() => {
        /* privacy-preserving default: keep blocking */
      })
    const off = window.recruit.on('settingsChanged', (settings) =>
      setBlock(settings.blockRemoteImages)
    )
    return () => {
      alive = false
      off()
    }
  }, [])

  return block
}

/** Re-exported so Mail keeps its own import surface; the implementation is shared. */
export { useDebounced } from '@renderer/components'

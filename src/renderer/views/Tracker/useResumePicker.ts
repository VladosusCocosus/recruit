/**
 * The resume list plus the actions the picker needs, in one hook.
 *
 * Every mutation goes back to main, which broadcasts `itemsChanged` and `resumesChanged` —
 * so the board and the item detail refresh from the push rather than from a local write.
 */

import { useCallback, useMemo, useState } from 'react'
import type { Resume } from '@shared/types'
import { errorMessage, useResumes } from '@renderer/components'
import type { ResumeMenuActions } from './ResumeMenu'

export interface ResumePicker {
  resumes: Resume[]
  byId: Map<number, Resume>
  actions: ResumeMenuActions
  error: string | null
  clearError: () => void
}

/** `onOpenSettings` opens Settings at the resume pane. */
export function useResumePicker(onOpenSettings: () => void): ResumePicker {
  const state = useResumes()
  const [error, setError] = useState<string | null>(null)
  const resumes = useMemo(() => state.data ?? [], [state.data])
  const byId = useMemo(() => new Map(resumes.map((r) => [r.id, r])), [resumes])

  const run = useCallback((work: Promise<unknown>): void => {
    work.catch((e: unknown) => setError(errorMessage(e)))
  }, [])

  const actions = useMemo<ResumeMenuActions>(
    () => ({
      onPick: (itemId, resumeId) => run(window.recruit.setItemResume(itemId, resumeId)),
      onSkip: (itemId, skipped) => run(window.recruit.skipItemResume(itemId, skipped)),
      onOpenPdf: (resumeId) => run(window.recruit.openResumePdf(resumeId)),
      onSavePdf: (resumeId) => run(window.recruit.saveResumePdf(resumeId)),
      onOpenSettings
    }),
    [run, onOpenSettings]
  )

  return {
    resumes,
    byId,
    actions,
    error: error ?? state.error,
    clearError: useCallback(() => setError(null), [])
  }
}

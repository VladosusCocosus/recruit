/**
 * The apply flow's state: the job input, the chosen master resume, the tailor run this
 * modal started, and the review the run comes back as. Mounted once by the shell and
 * handed to <ApplyModal>.
 *
 * `startRun` resolves when the process is spawned; the result envelope is written after
 * it exits. The run is therefore watched to a terminal state and read from `getRun`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorMessage, useResumeMasters, useRun } from '@renderer/components'
import { parseTailorResult } from '@shared/tailor'
import { applyTailorChanges } from '@shared/resumePatch'
import type {
  AppliedResume,
  JobDescriptionSource,
  ResumeMaster,
  TailorChange,
  TailorResult,
  WorkMode
} from '@shared/types'

/** Which of the two screens the modal is on. */
export type ApplyScreen = 'input' | 'review'

/** Where the review screen is: the run, the result, or the reason there is neither. */
export type ApplyPhase = 'running' | 'ready' | 'failed'

/** The extracted fields, held as form strings. '' is the empty/unset value. */
export interface ApplyFields {
  company: string
  role: string
  location: string
  workMode: WorkMode | ''
}

const EMPTY_FIELDS: ApplyFields = { company: '', role: '', location: '', workMode: '' }

const BLOCKED_BY_OTHER_RUN = 'Another run is in progress.'

/**
 * True when the whole input is one http(s) URL. Anything with whitespace in it is a job
 * description that happens to contain a link, which is the far more common paste.
 */
export function isJobUrl(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export interface ApplyStore {
  open: boolean
  openApply: () => void
  close: () => void
  screen: ApplyScreen
  phase: ApplyPhase

  /* ── screen 1 ── */
  jobInput: string
  setJobInput: (value: string) => void
  /** What `jobInput` will be committed as: a pasted description or a link to fetch. */
  jobSource: JobDescriptionSource
  masters: ResumeMaster[]
  mastersLoading: boolean
  mastersError: string | null
  master: ResumeMaster | null
  selectMaster: (masterId: number) => void
  /** Non-null when Tailor cannot be pressed, and says why. */
  tailorDisabledReason: string | null
  tailor: () => void

  /* ── the run ── */
  elapsedMs: number
  currentTool: string | null
  stopping: boolean
  stop: () => void
  /** Why the run produced no review. Set only in the 'failed' phase. */
  runError: string | null
  retry: () => void
  backToInput: () => void

  /* ── screen 2 ── */
  result: TailorResult | null
  fields: ApplyFields
  setField: <K extends keyof ApplyFields>(key: K, value: ApplyFields[K]) => void
  /** Indices into `result.changes` the user has rejected. */
  rejected: ReadonlySet<number>
  toggleChange: (index: number, accepted: boolean) => void
  acceptAll: () => void
  rejectAll: () => void
  /** The master with the accepted changes applied. Null until the result lands. */
  applied: AppliedResume | null
  committing: boolean
  commitError: string | null
  /** Non-null when Apply cannot be pressed, and says why. */
  commitDisabledReason: string | null
  /** Files the application. Resolves with the new item's id, or null on failure. */
  commit: () => Promise<number | null>
}

const UNREADABLE =
  "The run finished but didn't return a tailored resume this screen can read. Running it again usually fixes it."
const NO_ENVELOPE = 'The run finished but its result was never recorded.'
const STOPPED = 'You stopped the run before it returned anything.'
const FAILED = 'The run failed.'

export function useApply(): ApplyStore {
  const [open, setOpen] = useState(false)
  const [screen, setScreen] = useState<ApplyScreen>('input')
  const [phase, setPhase] = useState<ApplyPhase>('running')
  const [jobInput, setJobInput] = useState('')
  const [masterId, setMasterId] = useState<number | null>(null)

  /** True from our click until the tailor run reaches a terminal state. */
  const [pending, setPending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [result, setResult] = useState<TailorResult | null>(null)
  const [fields, setFields] = useState<ApplyFields>(EMPTY_FIELDS)
  const [rejected, setRejected] = useState<ReadonlySet<number>>(() => new Set())
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  const mastersState = useResumeMasters()
  const run = useRun()

  const masters = useMemo(() => mastersState.data ?? [], [mastersState.data])
  const reloadMasters = mastersState.reload

  // `masterId` is an override. With none set the selection is the default master.
  const master = useMemo(
    () =>
      masters.find((m) => m.id === masterId) ??
      masters.find((m) => m.isDefault) ??
      masters[0] ??
      null,
    [masters, masterId]
  )

  const openApply = useCallback(() => setOpen(true), [])

  const close = useCallback(() => {
    setOpen(false)
    setScreen('input')
    setPhase('running')
    setJobInput('')
    setPending(false)
    setStopping(false)
    setRunError(null)
    setResult(null)
    setFields(EMPTY_FIELDS)
    setRejected(new Set())
    setCommitError(null)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'n') return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ── the run ─────────────────────────────────────────────────────────────── */

  const readResult = useCallback(async (runId: number): Promise<void> => {
    if (runId < 0) {
      setPhase('failed')
      setRunError(NO_ENVELOPE)
      return
    }
    try {
      const record = await window.recruit.getRun(runId)
      const raw = record?.rawEnvelope?.result
      const parsed = typeof raw === 'string' ? parseTailorResult(raw) : null
      if (!parsed) {
        setPhase('failed')
        setRunError(typeof raw === 'string' ? UNREADABLE : NO_ENVELOPE)
        return
      }
      setResult(parsed)
      setFields({
        company: parsed.company ?? '',
        role: parsed.role ?? '',
        location: parsed.location ?? '',
        workMode: parsed.workMode ?? ''
      })
      setRejected(new Set())
      setPhase('ready')
    } catch (e) {
      setPhase('failed')
      setRunError(errorMessage(e))
    }
  }, [])

  // Resolves this screen when a run of OUR kind reaches a terminal state.
  const runKind = run.last?.kind
  const runState = run.last?.state
  const runId = run.last?.runId
  const runErrorText = run.last?.errorText
  useEffect(() => {
    if (!pending || runKind !== 'tailor') return
    if (runState === 'finished') {
      setPending(false)
      setStopping(false)
      void readResult(runId ?? -1)
    } else if (runState === 'error' || runState === 'stopped') {
      setPending(false)
      setStopping(false)
      setPhase('failed')
      setRunError(runErrorText ?? (runState === 'stopped' ? STOPPED : FAILED))
    }
  }, [pending, runKind, runState, runId, runErrorText, readResult])

  // A run that never started pushes no update at all; `useRun` reports it as an error.
  const startError = run.error
  useEffect(() => {
    if (!pending || !startError) return
    setPending(false)
    setStopping(false)
    setPhase('failed')
    setRunError(startError)
  }, [pending, startError])

  const startRun = useCallback(
    (input: string, selected: ResumeMaster): void => {
      setResult(null)
      setFields(EMPTY_FIELDS)
      setRejected(new Set())
      setCommitError(null)
      setRunError(null)
      setStopping(false)
      setScreen('review')
      setPhase('running')
      setPending(true)
      void run.start({ kind: 'tailor', jobInput: input, masterId: selected.id })
    },
    [run]
  )

  const jobSource: JobDescriptionSource = isJobUrl(jobInput) ? 'url' : 'pasted'
  const busy = pending || run.starting
  const blockedByOtherRun = !busy && run.active !== null

  const tailorDisabledReason =
    master === null
      ? 'Add a resume first.'
      : jobInput.trim() === ''
        ? 'Paste a job description, or a link to one.'
        : blockedByOtherRun
          ? BLOCKED_BY_OTHER_RUN
          : null

  const tailor = useCallback(() => {
    if (tailorDisabledReason !== null || master === null) return
    startRun(jobInput.trim(), master)
  }, [tailorDisabledReason, master, jobInput, startRun])

  const retry = useCallback(() => {
    if (master === null || blockedByOtherRun) return
    startRun(jobInput.trim(), master)
  }, [master, blockedByOtherRun, jobInput, startRun])

  const backToInput = useCallback(() => {
    setScreen('input')
    setPhase('running')
    setRunError(null)
    setResult(null)
  }, [])

  const stop = useCallback(() => {
    setStopping(true)
    void run.stop()
  }, [run])

  /* ── the review ──────────────────────────────────────────────────────────── */

  const setField = useCallback(
    <K extends keyof ApplyFields>(key: K, value: ApplyFields[K]): void => {
      setFields((prev) => ({ ...prev, [key]: value }))
      setCommitError(null)
    },
    []
  )

  const toggleChange = useCallback((index: number, accepted: boolean): void => {
    setRejected((prev) => {
      const next = new Set(prev)
      if (accepted) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const acceptAll = useCallback(() => setRejected(new Set()), [])
  const rejectAll = useCallback(
    () => setRejected(new Set((result?.changes ?? []).map((_, i) => i))),
    [result]
  )

  const accepted = useMemo<TailorChange[]>(
    () => (result ? result.changes.filter((_, i) => !rejected.has(i)) : []),
    [result, rejected]
  )

  const applied = useMemo<AppliedResume | null>(
    () => (result && master ? applyTailorChanges(master.contentMd, accepted) : null),
    [result, master, accepted]
  )

  const commitDisabledReason =
    applied === null
      ? 'Nothing to file yet.'
      : fields.company.trim() === ''
        ? 'Company is required.'
        : null

  const commit = useCallback(async (): Promise<number | null> => {
    if (!result || !master || !applied) return null
    const company = fields.company.trim()
    if (company === '') {
      setCommitError('Company is required.')
      return null
    }
    setCommitting(true)
    setCommitError(null)
    try {
      const item = await window.recruit.applyDraft({
        masterId: master.id,
        resumeMd: applied.markdown,
        company,
        role: fields.role.trim() || null,
        location: fields.location.trim() || null,
        workMode: fields.workMode === '' ? null : fields.workMode,
        jobUrl: jobSource === 'url' ? jobInput.trim() : null,
        jdMd: result.jdMd.trim() || (jobSource === 'pasted' ? jobInput.trim() : ''),
        jdSource: jobSource
      })
      return item.id
    } catch (e) {
      setCommitError(errorMessage(e))
      return null
    } finally {
      setCommitting(false)
    }
  }, [result, master, applied, fields, jobSource, jobInput])

  return {
    open,
    openApply,
    close,
    screen,
    phase,

    jobInput,
    setJobInput,
    jobSource,
    masters,
    mastersLoading: mastersState.loading,
    mastersError: mastersState.error,
    master,
    selectMaster: setMasterId,
    tailorDisabledReason,
    tailor,


    elapsedMs: run.elapsedMs,
    currentTool: run.active?.currentTool ?? null,
    stopping,
    stop,
    runError,
    retry,
    backToInput,

    result,
    fields,
    setField,
    rejected,
    toggleChange,
    acceptAll,
    rejectAll,
    applied,
    committing,
    commitError,
    commitDisabledReason,
    commit
  }
}

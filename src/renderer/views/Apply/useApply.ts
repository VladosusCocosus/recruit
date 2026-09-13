/**
 * The apply flow's state: the job input, the chosen resume, the tailor run this modal
 * started, and the review the run comes back as. Mounted once by the shell and handed
 * to <ApplyModal>.
 *
 * `useAgentRun().start` resolves once the tailor run is over, with the result envelope
 * already parsed, so this store branches on a returned outcome rather than on a watcher.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, useAgentRun, useResumes } from '@renderer/components'
import { parseTailorResult } from '@shared/tailor'
import { applyTailorChanges } from '@shared/resumePatch'
import { isEditableResume } from '@shared/types'
import type {
  AppliedResume,
  JobDescriptionSource,
  Resume,
  TailorChange,
  TailorResult,
  WorkMode
} from '@shared/types'
import { useAnswers, type AnswersStore } from '../Answers'

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

/** The application the flow created, and the resume it was filed with. */
export interface FiledApplication {
  itemId: number
  resumeId: number | null
  company: string
}

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
  /** Only resumes that hold markdown: a legacy record cannot be tailored. */
  resumes: Resume[]
  resumesLoading: boolean
  resumesError: string | null
  resume: Resume | null
  selectResume: (resumeId: number) => void
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
  /** The resume with the accepted changes applied. Null until the result lands. */
  applied: AppliedResume | null
  /**
   * True when the run adapted a cover letter. False means there is no template in
   * Settings, so no letter was written and none will be filed.
   */
  hasCoverLetter: boolean
  /** The adapted letter as the user has it. Filed verbatim; empty files nothing. */
  coverLetterMd: string
  setCoverLetter: (markdown: string) => void
  /** The questions this application will be filed with. Local until `commit`. */
  answers: AnswersStore
  committing: boolean
  commitError: string | null
  /** Set once the application exists. The flow cannot file a second one after this. */
  filed: FiledApplication | null
  savingPdf: boolean
  /** Renders the filed resume and saves it where the user chooses. */
  savePdf: () => Promise<boolean>
  /** Renders the filed resume and opens it. */
  openPdf: () => Promise<void>
  /** Non-null when Apply cannot be pressed, and says why. */
  commitDisabledReason: string | null
  /** Files the application. Resolves with the new item's id, or null on failure. */
  commit: () => Promise<number | null>
}

const UNREADABLE =
  "The run finished but didn't return a tailored resume this screen can read. Running it again usually fixes it."
const NO_ENVELOPE = 'The run finished but its result was never recorded.'
const STOPPED = 'You stopped the run before it returned anything.'

export function useApply(): ApplyStore {
  const [open, setOpen] = useState(false)
  const [screen, setScreen] = useState<ApplyScreen>('input')
  const [phase, setPhase] = useState<ApplyPhase>('running')
  const [jobInput, setJobInput] = useState('')
  const [resumeId, setResumeId] = useState<number | null>(null)

  const [runError, setRunError] = useState<string | null>(null)
  const [result, setResult] = useState<TailorResult | null>(null)
  const [fields, setFields] = useState<ApplyFields>(EMPTY_FIELDS)
  const [coverLetterMd, setCoverLetterMd] = useState('')
  const [rejected, setRejected] = useState<ReadonlySet<number>>(() => new Set())
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [filed, setFiled] = useState<FiledApplication | null>(null)
  const [savingPdf, setSavingPdf] = useState(false)

  const resumesState = useResumes()

  /** The tailored resume a finished run returned. Throws when there is nothing to read. */
  const readTailored = useCallback(async (runId: number): Promise<TailorResult> => {
    const record = await window.recruit.getRun(runId)
    const raw = record?.rawEnvelope?.result
    if (typeof raw !== 'string') throw new Error(NO_ENVELOPE)
    const parsed = parseTailorResult(raw)
    if (!parsed) throw new Error(UNREADABLE)
    return parsed
  }, [])

  const run = useAgentRun({ kind: 'tailor', read: readTailored })
  const start = run.start

  /** Bumped whenever the screen is reset, so a late outcome cannot revive it. */
  const generation = useRef(0)

  const resumes = useMemo(
    () => (resumesState.data ?? []).filter(isEditableResume),
    [resumesState.data]
  )

  // `resumeId` is an override. With none set the selection is the default resume.
  const resume = useMemo(
    () =>
      resumes.find((r) => r.id === resumeId) ??
      resumes.find((r) => r.isDefault) ??
      resumes[0] ??
      null,
    [resumes, resumeId]
  )

  const jobSource: JobDescriptionSource = isJobUrl(jobInput) ? 'url' : 'pasted'

  /** The description the answer runs read: what the run returned, else what was pasted. */
  const jdMd = (result?.jdMd ?? '').trim() || (jobSource === 'pasted' ? jobInput.trim() : '')

  const answers = useAnswers({ kind: 'draft', jdMd, resumeId: resume?.id ?? null })
  const resetAnswers = answers.reset

  const openApply = useCallback(() => setOpen(true), [])

  const close = useCallback(() => {
    generation.current += 1
    setOpen(false)
    setScreen('input')
    setPhase('running')
    setJobInput('')
    setRunError(null)
    setResult(null)
    setFields(EMPTY_FIELDS)
    setCoverLetterMd('')
    setRejected(new Set())
    setCommitError(null)
    setFiled(null)
    resetAnswers()
  }, [resetAnswers])

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

  const startRun = useCallback(
    (input: string, selected: Resume): void => {
      setResult(null)
      setFields(EMPTY_FIELDS)
      setCoverLetterMd('')
      setRejected(new Set())
      setCommitError(null)
      setRunError(null)
      setScreen('review')
      setPhase('running')
      const mine = (generation.current += 1)
      void start({ jobInput: input, resumeId: selected.id }).then((outcome) => {
        if (mine !== generation.current) return
        if (!outcome.ok) {
          setPhase('failed')
          setRunError(outcome.stopped ? STOPPED : outcome.error)
          return
        }
        setResult(outcome.value)
        setFields({
          company: outcome.value.company ?? '',
          role: outcome.value.role ?? '',
          location: outcome.value.location ?? '',
          workMode: outcome.value.workMode ?? ''
        })
        setCoverLetterMd(outcome.value.coverLetterMd ?? '')
        setRejected(new Set())
        setPhase('ready')
      })
    },
    [start]
  )

  const tailorDisabledReason =
    resume === null
      ? 'Add a resume first.'
      : jobInput.trim() === ''
        ? 'Paste a job description, or a link to one.'
        : run.blockedReason

  const tailor = useCallback(() => {
    if (tailorDisabledReason !== null || resume === null) return
    startRun(jobInput.trim(), resume)
  }, [tailorDisabledReason, resume, jobInput, startRun])

  const retry = useCallback(() => {
    if (resume === null || run.blockedReason !== null) return
    startRun(jobInput.trim(), resume)
  }, [resume, run.blockedReason, jobInput, startRun])

  const backToInput = useCallback(() => {
    generation.current += 1
    setScreen('input')
    setPhase('running')
    setRunError(null)
    setResult(null)
  }, [])

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
    () =>
      result && resume && resume.contentMd !== null
        ? applyTailorChanges(resume.contentMd, accepted)
        : null,
    [result, resume, accepted]
  )

  const commitDisabledReason =
    applied === null
      ? 'Nothing to file yet.'
      : fields.company.trim() === ''
        ? 'Company is required.'
        : null

  const hasCoverLetter = (result?.coverLetterMd ?? null) !== null
  const questions = answers.questions

  const commit = useCallback(async (): Promise<number | null> => {
    if (!result || !resume || !applied) return null
    const company = fields.company.trim()
    if (company === '') {
      setCommitError('Company is required.')
      return null
    }
    setCommitting(true)
    setCommitError(null)
    try {
      const item = await window.recruit.applyDraft({
        resumeId: resume.id,
        resumeMd: applied.markdown,
        company,
        role: fields.role.trim() || null,
        location: fields.location.trim() || null,
        workMode: fields.workMode === '' ? null : fields.workMode,
        jobUrl: jobSource === 'url' ? jobInput.trim() : null,
        jdMd,
        jdSource: jobSource,
        coverLetterMd: coverLetterMd.trim() === '' ? null : coverLetterMd,
        questions
      })
      setFiled({ itemId: item.id, resumeId: item.resumeId, company })
      return item.id
    } catch (e) {
      setCommitError(errorMessage(e))
      return null
    } finally {
      setCommitting(false)
    }
  }, [result, resume, applied, fields, jobSource, jobInput, jdMd, coverLetterMd, questions])

  /* ── the file the user came for ──────────────────────────────────────────── */

  const savePdf = useCallback(async (): Promise<boolean> => {
    if (filed?.resumeId == null) return false
    setSavingPdf(true)
    setCommitError(null)
    try {
      return (await window.recruit.saveResumePdf(filed.resumeId)) !== null
    } catch (e) {
      setCommitError(errorMessage(e))
      return false
    } finally {
      setSavingPdf(false)
    }
  }, [filed])

  const openPdf = useCallback(async (): Promise<void> => {
    if (filed?.resumeId == null) return
    setSavingPdf(true)
    setCommitError(null)
    try {
      await window.recruit.openResumePdf(filed.resumeId)
    } catch (e) {
      setCommitError(errorMessage(e))
    } finally {
      setSavingPdf(false)
    }
  }, [filed])

  return {
    open,
    openApply,
    close,
    screen,
    phase,

    jobInput,
    setJobInput,
    jobSource,
    resumes,
    resumesLoading: resumesState.loading,
    resumesError: resumesState.error,
    resume,
    selectResume: setResumeId,
    tailorDisabledReason,
    tailor,

    elapsedMs: run.elapsedMs,
    currentTool: run.active?.currentTool ?? null,
    stopping: run.stopping,
    stop: run.stop,
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
    hasCoverLetter,
    coverLetterMd,
    setCoverLetter: setCoverLetterMd,
    answers,
    committing,
    commitError,
    commitDisabledReason,
    commit,
    filed,
    savingPdf,
    savePdf,
    openPdf
  }
}

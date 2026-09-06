/**
 * Every RecruitApi method, wired to the module that owns it.
 *
 * This file is glue and nothing else: where two modules disagree on a shape, the
 * adaptation happens HERE rather than in either module. See the notes on each site.
 */
import { app, nativeTheme, shell } from 'electron'
import type {
  AgentRunSummary,
  ApplicationDocumentKind,
  AppSettings,
  Item,
  ProposalDecisionResult,
  Resume,
  StartRunInput
} from '@shared/types'
import * as db from '@main/db'
import { renderDocumentPdf } from '@main/render'
import * as resumes from '@main/resumes'
import { sanitizeMessageBody } from '@main/mail/sanitize'
import { getSettings, updateSettings } from '@main/settings'
import * as updates from '@main/update'
import { testConnection } from '@main/settings/verify'
import type { StartedRun } from '@main/agent'
import type { Notifier } from '@main/notifications'
import { deleteAccountWithSecrets, saveAccountWithSecrets } from './accounts'
import { broadcast, handle } from './bridge'
import type { AppServices } from './services'

/** Schemes the renderer is allowed to hand to the OS. Mail bodies are hostile input. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Set by registerIpcHandlers. The notify* helpers below are module-level and predate
 * services, so the notifier reaches them this way rather than through a parameter on
 * every call site.
 */
let notifier: Notifier | null = null

function notifyProposals(): void {
  broadcast('proposalsChanged', { pending: db.countPendingProposals() })
  notifier?.refresh()
}

function notifyItems(itemIds: Array<number | null | undefined>): void {
  const ids = [...new Set(itemIds.filter((id): id is number => typeof id === 'number'))]
  broadcast('itemsChanged', { itemIds: ids })
  notifier?.refresh()
}

function notifyResumes(): void {
  broadcast('resumesChanged', { resumes: db.listResumes() })
}

/** The row behind an id from the renderer. Resumes cross IPC as ids, never as paths. */
function requireResume(resumeId: number): Resume {
  const resume = db.getResume(resumeId)
  if (!resume) throw new Error(`Resume ${resumeId} not found.`)
  return resume
}

/** The markdown of a resume, or an error naming the row that has none. */
function requireResumeText(resume: Resume, what: string): string {
  if (resume.contentMd === null) {
    throw new Error(
      `"${resume.label}" is a record of a file that is no longer stored, so ${what}.`
    )
  }
  return resume.contentMd
}

function requireItem(itemId: number): Item {
  const item = db.getItem(itemId)
  if (!item) throw new Error(`Application ${itemId} not found.`)
  return item
}

/** The app_kv key holding the cover letter a tailor run adapts. */
const COVER_LETTER_TEMPLATE_KEY = 'cover_letter_template'

/** The stored template. Empty string when there is none. */
function coverLetterTemplate(): string {
  const stored = db.kvGet<string>(COVER_LETTER_TEMPLATE_KEY, '')
  return typeof stored === 'string' ? stored : ''
}

/** The same template as a tailor run takes it: the text, or null when it is blank. */
function coverLetterTemplateForRun(): string | null {
  const template = coverLetterTemplate()
  return template.trim() === '' ? null : template
}

const DOCUMENT_LABEL: Record<ApplicationDocumentKind, string> = {
  resume: 'resume',
  cover_letter: 'cover letter'
}

/**
 * The stored PDF an application was sent, and the name a "save a copy" dialog should
 * offer. The path comes from the database — the renderer names an item and a kind.
 */
function itemDocument(
  itemId: number,
  kind: ApplicationDocumentKind
): { path: string; defaultName: string } {
  const item = requireItem(itemId)
  const path =
    kind === 'resume'
      ? item.resumeId === null
        ? null
        : db.resumePdfPath(item.resumeId)
      : db.itemCoverLetterPdfPath(itemId)

  if (!path) {
    throw new Error(`No ${DOCUMENT_LABEL[kind]} PDF is stored for the ${item.company} application.`)
  }

  const suffix = kind === 'resume' ? 'Resume' : 'Cover letter'
  return { path, defaultName: `${item.company} — ${suffix}` }
}

function afterDecisions(results: ProposalDecisionResult[]): void {
  notifyProposals()
  notifyItems(results.map((r) => r.createdItemId))
}

function runSummary(runId: number): AgentRunSummary {
  const summary = db.getRunSummary(runId)
  if (!summary) throw new Error(`Agent run ${runId} disappeared`)
  return summary
}

export function registerIpcHandlers(services: AppServices): void {
  const { mail, runner } = services
  notifier = services.notifier

  /* ── app / settings ─────────────────────────────────────────────────────── */

  handle('getAppInfo', () => ({
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    dbPath: db.getDbPath() ?? '',
    agentEngine: getSettings().agentEngine,
    agentCliAvailable: runner.isAgentCliAvailable(),
    setupGuideUrl: updates.setupGuideUrl()
  }))

  // MainSettings is now just an alias for AppSettings — there are no main-only keys
  // left, so what is stored is exactly what crosses IPC.
  handle('getSettings', () => getSettings())

  handle('updateSettings', (patch: Partial<AppSettings>) => {
    const before = getSettings()
    const next = updateSettings(patch)

    if (next.theme !== before.theme) nativeTheme.themeSource = next.theme

    // MailSync captures the backfill window and poll interval at construction, so those
    // two only take effect on a reconnect.
    if (
      next.syncIntervalMinutes !== before.syncIntervalMinutes ||
      next.syncBackfillDays !== before.syncBackfillDays
    ) {
      for (const account of db.listAccounts()) {
        void mail.refreshAccount(account.id).catch(() => undefined)
      }
    }

    // Any switch from "nothing enabled" to "something enabled" posts the confirmation,
    // whether it came from the first-run step or from Settings. That post is what raises
    // the macOS permission prompt, so it lands while the user is still looking at the
    // control they just used.
    const wasOn = before.notifyInterviews || before.notifyProposals || before.notifyDebriefs
    const isOn = next.notifyInterviews || next.notifyProposals || next.notifyDebriefs
    if (!wasOn && isOn) services.notifier.confirmEnabled()

    if (
      wasOn !== isOn ||
      next.notifyInterviews !== before.notifyInterviews ||
      next.notifyDebriefs !== before.notifyDebriefs ||
      next.notifyLeadMinutes !== before.notifyLeadMinutes
    ) {
      services.notifier.refresh()
    }

    broadcast('settingsChanged', next)
    return next
  })

  handle('getCounts', () => db.getAppCounts())
  handle('getSetupState', () => ({
    ...db.getSetupState(),
    notificationsAsked: getSettings().notificationsAsked
  }))

  handle('openExternal', async (url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`Not a URL: ${url}`)
    }
    if (!EXTERNAL_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Refusing to open ${parsed.protocol} link`)
    }
    await shell.openExternal(parsed.toString())
  })

  handle('revealDatabase', async () => {
    const path = db.getDbPath()
    if (!path) throw new Error('The database has no path on disk yet')
    shell.showItemInFolder(path)
  })

  /* ── accounts ───────────────────────────────────────────────────────────── */

  handle('listAccounts', () => db.listAccounts())
  handle('getAccount', (accountId) => db.getAccount(accountId))

  handle('saveAccount', async (input) => {
    const account = await saveAccountWithSecrets(input)
    // Reconnect with the new host/credentials. Fire-and-forget: a bad password must
    // surface as a sync error, not as a failed save.
    void mail.refreshAccount(account.id).catch(() => undefined)
    return account
  })

  handle('deleteAccount', async (accountId) => {
    await mail.forgetAccount(accountId)
    await deleteAccountWithSecrets(accountId)
  })

  handle('testConnection', (input) => testConnection(input))

  /* ── mail (read-only) ───────────────────────────────────────────────────── */

  handle('syncNow', (accountId) => mail.syncNow(accountId))

  handle('cancelSync', async () => {
    mail.cancel()
  })

  handle('getSyncStatus', () => mail.status())

  handle('listMessages', (query) => db.listMessages(query))
  handle('getMessage', (messageId) => db.getMessage(messageId))

  handle('getMessageHtml', (messageId, allowRemoteImages) => {
    const message = db.getMessage(messageId)
    // blockRemoteImages is the standing policy; allowRemoteImages is the reader's
    // per-message "load images" click, which overrides it for this call only.
    const allow = allowRemoteImages || !getSettings().blockRemoteImages
    if (!message) {
      return { html: '', hadRemoteImages: false, blockedImageCount: 0, remoteImagesAllowed: allow }
    }
    return sanitizeMessageBody({ html: message.bodyHtml, text: message.bodyText }, allow)
  })

  handle('setTriageState', async (messageIds, state) => {
    db.setTriageState(messageIds, state)
  })

  // Local read state. The IMAP session is never told — see the read-only note above.
  handle('markMessagesRead', async (messageIds, read) => {
    db.markMessagesRead(messageIds, read)
  })

  // Local soft delete, same deal: the message stays on the server, it just stops existing
  // here. Reversible by design, which is why the renderer offers undo instead of a dialog.
  handle('deleteMessages', async (messageIds, deleted) => {
    db.deleteMessages(messageIds, deleted)
  })

  handle('rescorePrefilter', () => mail.rescore())

  /* ── tracker ────────────────────────────────────────────────────────────── */

  handle('listStatuses', () => db.listStatuses())
  handle('listItems', (query) => db.listItems(query))

  // RecruitApi.getItem returns ItemDetail; db.getItem returns a bare Item.
  handle('getItem', (itemId) => db.getItemWithTimeline(itemId))

  handle('createItem', (input) => {
    const item = db.createItem(input)
    notifyItems([item.id])
    return item
  })

  handle('updateItem', (itemId, patch) => {
    const item = db.updateItem(itemId, patch)
    notifyItems([itemId])
    return item
  })

  handle('setItemStatus', (itemId, statusKey, closeReason) => {
    const item = db.setItemStatus(itemId, statusKey, closeReason ?? null, { source: 'user' })
    notifyItems([itemId])
    return item
  })

  handle('archiveItem', (itemId, archived) => {
    const item = db.archiveItem(itemId, archived)
    notifyItems([itemId])
    return item
  })

  handle('deleteItem', async (itemId) => {
    db.deleteItem(itemId)
    notifyItems([itemId])
  })

  handle('linkMessage', async (itemId, messageId) => {
    db.linkMessage(itemId, messageId)
    notifyItems([itemId])
  })

  handle('unlinkMessage', async (itemId, messageId) => {
    db.unlinkMessage(itemId, messageId)
    notifyItems([itemId])
  })

  /* ── resumes ────────────────────────────────────────────────────────────── */

  handle('listResumes', () => db.listResumes())

  handle('createResume', async (input) => {
    const resume = db.createResume(input)
    notifyResumes()
    return resume
  })

  handle('importResume', async () => {
    const input = await resumes.pickResumeText()
    if (!input) return null
    const resume = db.createResume(input)
    notifyResumes()
    return resume
  })

  handle('updateResume', async (resumeId, patch) => {
    const resume = db.updateResume(resumeId, patch)
    notifyResumes()
    return resume
  })

  handle('setDefaultResume', async (resumeId) => {
    db.markDefault(resumeId)
    notifyResumes()
    return db.listResumes()
  })

  handle('archiveResume', async (resumeId) => {
    db.archiveResume(resumeId)
    notifyResumes()
    return db.listResumes()
  })

  handle('openResumePdf', (resumeId) => resumes.openResumePdf(requireResume(resumeId)))

  handle('saveResumePdf', (resumeId) => resumes.saveResumePdf(requireResume(resumeId)))

  handle('getCoverLetterTemplate', async () => coverLetterTemplate())

  handle('setCoverLetterTemplate', async (markdown) => {
    db.kvSet(COVER_LETTER_TEMPLATE_KEY, markdown)
  })

  /* ── what an application was sent ───────────────────────────────────────── */

  handle('openItemDocument', (itemId, kind) =>
    resumes.openStoredPdf(itemDocument(itemId, kind).path)
  )

  handle('saveItemDocument', (itemId, kind) => {
    const document = itemDocument(itemId, kind)
    return resumes.saveStoredPdfAs(document.path, document.defaultName)
  })

  handle('revealItemDocument', async (itemId, kind) => {
    resumes.revealStoredPdf(itemDocument(itemId, kind).path)
  })

  /* ── application questions ──────────────────────────────────────────────── */

  handle('listItemAnswers', (itemId) => db.listItemAnswers(itemId))

  handle('saveItemAnswer', async (input) => {
    const answer = db.saveItemAnswer(input)
    notifyItems([answer.itemId])
    return answer
  })

  handle('deleteItemAnswer', async (answerId) => {
    const answer = db.getItemAnswer(answerId)
    db.deleteItemAnswer(answerId)
    notifyItems([answer?.itemId])
  })

  handle('setItemResume', async (itemId, resumeId) => {
    const item = db.setItemResume(itemId, resumeId)
    notifyItems([itemId])
    notifyResumes()
    return item
  })

  handle('skipItemResume', async (itemId, skipped) => {
    const item = db.skipItemResume(itemId, skipped)
    notifyItems([itemId])
    return item
  })

  // The tailored markdown is filed as a resume derived from the one it started from. Both
  // documents are rendered and stored as the copy that was sent, and every question the
  // form asked is filed against the new application.
  handle('applyDraft', async (input) => {
    const company = input.company.trim()
    if (!company) throw new Error('An application needs a company.')
    if (!input.resumeMd.trim()) throw new Error('The tailored resume is empty.')

    const source = requireResume(input.resumeId)
    requireResumeText(source, 'there is nothing to apply with')

    const label = `${source.label} — ${company}`
    const coverLetterMd = input.coverLetterMd?.trim() ? input.coverLetterMd : null

    const resumePdf = await renderDocumentPdf(input.resumeMd)
    const coverLetterPdf = coverLetterMd ? await renderDocumentPdf(coverLetterMd) : null
    const resumePdfPath = resumes.storeDocumentPdf(resumePdf, label)
    const coverLetterPdfPath = coverLetterPdf
      ? resumes.storeDocumentPdf(coverLetterPdf, `${company} — Cover letter`)
      : null

    const resume = db.createResume({
      label,
      contentMd: input.resumeMd,
      derivedFromId: source.id
    })
    db.setResumePdf(resume.id, resumePdfPath)

    const created = db.createItem({
      company,
      role: input.role,
      location: input.location,
      workMode: input.workMode,
      jobUrl: input.jobUrl,
      jdMd: input.jdMd,
      jdSource: input.jdSource,
      source: 'apply',
      statusKey: 'applied'
    })
    db.setItemResume(created.id, resume.id)
    const item = db.setItemCoverLetter(created.id, coverLetterMd, coverLetterPdfPath)

    for (const entry of input.questions) {
      if (!entry.question.trim()) continue
      db.saveItemAnswer({ itemId: item.id, question: entry.question, answerMd: entry.answerMd })
    }

    notifyItems([item.id])
    notifyResumes()
    return item
  })

  /* ── timeline ───────────────────────────────────────────────────────────── */

  handle('listUpcomingEvents', (limit) => db.upcomingEvents(limit))

  handle('addEvent', (input) => {
    const event = db.addEvent(input)
    notifyItems([event.itemId])
    return event
  })

  handle('updateEvent', (eventId, patch) => {
    const event = db.updateEvent(eventId, patch)
    notifyItems([event.itemId])
    return event
  })

  handle('deleteEvent', async (eventId) => {
    const event = db.getEvent(eventId)
    db.deleteEvent(eventId)
    notifyItems([event?.itemId])
  })

  /* ── call debriefs ──────────────────────────────────────────────────────── */

  handle('listPendingDebriefs', () => db.pendingDebriefs())

  handle('saveDebrief', async (input) => {
    notifyItems([db.saveDebrief(input)])
  })

  handle('snoozeDebrief', async (eventId, untilIso) => {
    notifyItems([db.snoozeDebrief(eventId, untilIso)])
  })

  handle('skipDebrief', async (eventId) => {
    notifyItems([db.skipDebrief(eventId)])
  })

  /* ── review queue ───────────────────────────────────────────────────────── */

  handle('listProposals', (query) => db.listProposalCards(query))

  handle('acceptProposal', (proposalId) => {
    const result = db.acceptProposal(proposalId, { source: 'agent' })
    afterDecisions([result])
    return result
  })

  handle('rejectProposal', (proposalId) => {
    const result = db.rejectProposal(proposalId)
    afterDecisions([result])
    return result
  })

  handle('acceptProposals', (proposalIds) => {
    const results = db.acceptProposals(proposalIds, { source: 'agent' })
    afterDecisions(results)
    return results
  })

  handle('rejectProposals', (proposalIds) => {
    const results = db.rejectProposals(proposalIds)
    afterDecisions(results)
    return results
  })

  /* ── agent ──────────────────────────────────────────────────────────────── */

  handle('getCandidateCount', () => db.countCandidates())

  handle('startRun', async (input: StartRunInput) => {
    const settings = getSettings()

    // The toolbar RUN button turns into a live status while a run is in flight, so the UI
    // cannot start a second one — but the IPC channel can. Two triage runs over the same
    // candidates would duplicate every proposal in the review queue.
    const inFlight = runner.getActiveRun()
    if (inFlight) {
      throw new Error(`A ${inFlight.kind} run is already in progress (run ${inFlight.runId}).`)
    }

    if (input.kind === 'enrich') {
      const company = input.company?.trim()
      if (!company) throw new Error('An enrich run needs a company name.')
      const started = await runner.spawnEnrichRun(company, { model: input.model })
      watchRun(started, [], input.itemId ?? null)
      return runSummary(started.runId)
    }

    // A tailor run files nothing. Its whole output is the envelope, which the apply
    // modal reads back with getRun once the run reaches a terminal state.
    if (input.kind === 'tailor') {
      const jobInput = input.jobInput?.trim()
      if (!jobInput) throw new Error('A tailor run needs a job description or a link.')
      if (input.resumeId === undefined) throw new Error('A tailor run needs a resume.')
      const resume = requireResume(input.resumeId)
      const resumeMd = requireResumeText(resume, 'it cannot be tailored')
      const started = await runner.spawnTailorRun(
        jobInput,
        resumeMd,
        coverLetterTemplateForRun(),
        { model: input.model }
      )
      watchRun(started)
      return runSummary(started.runId)
    }

    // An answer run files nothing either: its whole reply is the drafted answer, which
    // the apply modal reads back with getRun.
    if (input.kind === 'answer') {
      const question = input.question?.trim()
      if (!question) throw new Error('An answer run needs a question.')

      const item = input.itemId === undefined ? null : requireItem(input.itemId)
      const jdMd = item?.jdMd ?? input.jdMd ?? ''
      const resumeId = item?.resumeId ?? input.resumeId
      if (resumeId === undefined || resumeId === null) {
        throw new Error('An answer run needs a resume.')
      }
      const resume = requireResume(resumeId)
      const resumeMd = requireResumeText(resume, 'it cannot be used to draft an answer')

      const started = await runner.spawnAnswerRun(question, jdMd, resumeMd, {
        model: input.model
      })
      watchRun(started)
      return runSummary(started.runId)
    }

    const cap = Math.max(1, settings.maxCandidatesPerRun)
    const requested = input.messageIds?.length
      ? input.messageIds
      : db.listCandidates(cap).map((m) => m.id)
    if (!requested.length) {
      throw new Error('Nothing to triage — no messages are flagged as candidates.')
    }

    // Truncating without saying so is how a 70-message inbox quietly becomes 40.
    if (requested.length > cap) {
      throw new Error(
        `${requested.length} candidates exceeds the per-run limit of ${cap}. ` +
          'Raise "Max candidates per run" in Settings, or select a subset of messages.'
      )
    }
    const messageIds = requested
    const started = await runner.spawnTriageRun(messageIds, { model: input.model })
    watchRun(started, messageIds)
    return runSummary(started.runId)
  })

  handle('stopRun', async (runId) => {
    runner.cancelRun(runId)
  })

  handle('getActiveRun', () => runner.getActiveRun())
  handle('getRun', (runId) => db.getRun(runId))
  handle('listRuns', (limit) => db.listRuns(limit))

  // ── updates ───────────────────────────────────────────────────────────────
  handle('getUpdateStatus', async () => updates.getUpdateStatus())
  handle('checkForUpdate', () => updates.checkForUpdate())
  handle('openDownload', () => updates.openDownload())

  // Push status changes so a banner can appear without the renderer polling.
  updates.onUpdateStatus((status) => broadcast('updateAvailable', status))
  updates.startUpdateChecks()
}

/** A run-away description is not worth storing. Enrichment writes prose, not a document. */
const MAX_DESCRIPTION_CHARS = 8_000

/**
 * `StartedRun.completed` never rejects — it resolves with the terminal AgentRunResult.
 * The runner has already written the agent_runs row and pushed the final runUpdate by
 * then, so all that is left is the review-queue badge and clearing the candidate pill.
 */
function watchRun(
  started: StartedRun,
  messageIds: number[] = [],
  enrichItemId: number | null = null
): void {
  void started.completed.then((result) => {
    if (result.kind === 'ok' && messageIds.length) {
      // Only messages still sitting at 'candidate' — never clobber linked/dismissed,
      // and never undo a link the applier wrote while the run was in flight.
      db.execute(
        `UPDATE messages SET triage_state = 'processed'
         WHERE triage_state = 'candidate' AND id IN (${db.placeholders(messageIds.length)})`,
        ...messageIds
      )
    }

    // An enrich run has NO tracker tools by design — it cannot propose anything itself,
    // and its whole output is the envelope text. Turning that into an update_item
    // proposal is what makes StartRunInput.itemId mean something; without it the run
    // would finish and vanish. It still lands in the Review queue like any other write.
    if (result.kind === 'ok' && enrichItemId !== null) {
      const description = result.result.trim().slice(0, MAX_DESCRIPTION_CHARS)
      if (description) {
        try {
          db.insertProposal({
            runId: result.runId,
            kind: 'update_item',
            targetItemId: enrichItemId,
            payload: { item_id: enrichItemId, fields: { description_md: description } },
            confidence: 0.6,
            rationale: 'Company description from an enrichment run (web search).'
          })
        } catch (error) {
          console.error('[agent] could not record the enrichment result:', error)
        }
      }
    }

    notifyProposals()
    if (enrichItemId !== null) notifyItems([enrichItemId])
    if (result.kind === 'ok') notifier?.proposalsReady(db.countPendingProposalsByRun(result.runId))
  })
}

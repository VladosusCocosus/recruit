/**
 * Recruit — shared types. The single source of truth for main <-> preload <-> renderer.
 *
 * CONVENTIONS every agent must follow:
 *  1. Domain objects are camelCase. SQLite columns are snake_case (see the project schema).
 *     The db module owns the mapping and MUST export rowToAccount/rowToMessage/rowToItem/
 *     rowToTimelineEvent/rowToProposal/rowToAgentRun. Nobody else hand-maps rows.
 *  2. `*_json` columns are parsed here into real values (to, cc, references, flags, reasons).
 *  3. WIRE shapes stay literal: MCP tool payloads and the claude CLI envelope keep their
 *     snake_case field names exactly. Do not camelCase them — the agent emits them verbatim.
 *  4. Timestamps are ISO-8601 UTC strings everywhere ("2026-08-26T12:00:00.000Z").
 *     Never send Date objects across IPC.
 *  5. Booleans are real booleans in TS; the db layer converts to/from SQLite 0/1.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Enums / unions
 * ──────────────────────────────────────────────────────────────────────────── */

export type TriageState = 'unseen' | 'candidate' | 'processed' | 'dismissed' | 'linked'

export type StatusKind = 'open' | 'closed'
export type StatusKey = 'saved' | 'applied' | 'screening' | 'interviewing' | 'offer' | 'closed'
export type CloseReason = 'rejected' | 'withdrawn' | 'accepted' | 'ghosted'

export type WorkMode = 'onsite' | 'hybrid' | 'remote'
export type DescriptionSource = 'agent' | 'user'

export type TimelineEventKind = 'email' | 'status_change' | 'meeting' | 'note' | 'task'
export type TimelineEventSource = 'agent' | 'user' | 'ics'

export type ProposalKind =
  | 'create_item'
  | 'update_item'
  | 'set_status'
  | 'add_event'
  | 'link_message'
export type ProposalState = 'pending' | 'accepted' | 'rejected' | 'superseded'

export type AgentRunKind = 'triage' | 'enrich'
export type AgentRunState = 'starting' | 'running' | 'finished' | 'error' | 'stopped'

/**
 * Which CLI the agent bridge spawns. Both run as a subprocess on the user's own
 * subscription auth — Recruit never holds an API key for either.
 */
export const AGENT_ENGINES = ['claude', 'codex'] as const
export type AgentEngine = (typeof AGENT_ENGINES)[number]

/** Product name of each engine, for UI copy. */
export const AGENT_ENGINE_LABEL: Record<AgentEngine, string> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

/** The binary each engine is invoked as, for UI copy and PATH search. */
export const AGENT_ENGINE_BINARY: Record<AgentEngine, string> = {
  claude: 'claude',
  codex: 'codex'
}

export type ThemePreference = 'system' | 'light' | 'dark'
export type ConnectionProtocol = 'imap' | 'smtp'

/** Left-rail destinations. Renderer routing key. */
export type NavKey = 'inbox' | 'candidates' | 'board' | 'review' | 'upnext' | 'settings'

/* ────────────────────────────────────────────────────────────────────────────
 * Primitives
 * ──────────────────────────────────────────────────────────────────────────── */

export interface EmailAddress {
  name: string | null
  address: string
}

/* ────────────────────────────────────────────────────────────────────────────
 * accounts
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Account {
  id: number
  email: string
  displayName: string | null
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapUser: string
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean | null
  smtpUser: string | null
  /** Keychain account key for the IMAP password. Passwords are NEVER stored in SQLite. */
  keychainRefImap: string | null
  keychainRefSmtp: string | null
  lastUidValidity: number | null
  lastUid: number | null
  createdAt: string
}

/** What the Settings form submits. Passwords go straight to the Keychain. */
export interface AccountInput {
  /** Omit to create, provide to update. */
  id?: number
  email: string
  displayName?: string | null
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapUser: string
  /** Write-only. Omit on edit to keep the stored password. */
  imapPassword?: string
  smtpHost?: string | null
  smtpPort?: number | null
  smtpSecure?: boolean | null
  smtpUser?: string | null
  /** Stored + connection-tested, but NEVER used to send in v1. */
  smtpPassword?: string
}

export interface ConnectionTestInput {
  protocol: ConnectionProtocol
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

export interface ConnectionTestResult {
  ok: boolean
  protocol: ConnectionProtocol
  greeting: string | null
  capabilities: string[]
  error: string | null
  durationMs: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * messages + attachments
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Attachment {
  id: number
  messageId: number
  filename: string | null
  mimeType: string | null
  size: number | null
  contentId: string | null
  /** Absolute path under userData/attachments. Null if not persisted to disk. */
  diskPath: string | null
  isCalendar: boolean
}

/** Row shape for the mail list. Cheap: no bodies. */
export interface MessageSummary {
  id: number
  accountId: number
  folder: string
  uid: number
  uidValidity: number
  threadKey: string | null
  fromName: string | null
  fromAddr: string | null
  fromDomain: string | null
  subject: string | null
  dateUtc: string | null
  snippet: string | null
  hasAttachments: boolean
  flags: string[]
  /**
   * Derived: no '\\Seen' flag AND no local read_at. Local only — v1 never writes IMAP flags,
   * so opening a message clears this here and nowhere else.
   */
  isUnread: boolean
  prefilterScore: number | null
  prefilterReasons: PrefilterReason[]
  triageState: TriageState
  /** Cheap join so the list can show a tracker badge. */
  linkedItemIds: number[]
}

/** Full message, bodies included. */
export interface Message extends MessageSummary {
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  to: EmailAddress[]
  cc: EmailAddress[]
  bodyText: string | null
  bodyHtml: string | null
  listUnsubscribe: string | null
  fetchedAt: string
  attachments: Attachment[]
}

export interface MessageQuery {
  accountId?: number
  folder?: string
  /** Single state or a set. Omit for all. */
  triageState?: TriageState | TriageState[]
  /** Free text over subject / from / snippet. */
  search?: string
  minScore?: number
  unlinkedOnly?: boolean
  limit?: number
  offset?: number
}

export interface MessageListPage {
  rows: MessageSummary[]
  total: number
  limit: number
  offset: number
}

/**
 * Result of sanitizing a message body for the reader.
 * Remote images are stripped unless allowRemoteImages is true; the reader shows a
 * "load images" bar when hadRemoteImages && !allowed.
 */
export interface SanitizedBody {
  html: string
  hadRemoteImages: boolean
  blockedImageCount: number
  remoteImagesAllowed: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
 * statuses + items
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Status {
  id: number
  key: string
  label: string
  kind: StatusKind
  sortOrder: number
  color: string | null
}

/** Seeded on first migration, in this order. */
export const STATUS_SEED: ReadonlyArray<Omit<Status, 'id'>> = [
  { key: 'saved', label: 'Saved', kind: 'open', sortOrder: 1, color: '#8E8E93' },
  { key: 'applied', label: 'Applied', kind: 'open', sortOrder: 2, color: '#0A84FF' },
  { key: 'screening', label: 'Screening', kind: 'open', sortOrder: 3, color: '#5E5CE6' },
  { key: 'interviewing', label: 'Interviewing', kind: 'open', sortOrder: 4, color: '#FF9F0A' },
  { key: 'offer', label: 'Offer', kind: 'open', sortOrder: 5, color: '#30D158' },
  { key: 'closed', label: 'Closed', kind: 'closed', sortOrder: 6, color: '#FF453A' }
]

export interface Item {
  id: number
  company: string
  companyDomain: string | null
  role: string | null
  location: string | null
  workMode: WorkMode | null
  source: string | null
  jobUrl: string | null
  compensationNote: string | null
  statusId: number
  /** Denormalized from statuses for convenience — always joined on read. */
  statusKey: string
  closeReason: CloseReason | null
  descriptionMd: string | null
  descriptionSource: DescriptionSource | null
  descriptionUpdatedAt: string | null
  contactName: string | null
  contactEmail: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

/** Board / list row. */
export interface ItemSummary extends Item {
  messageCount: number
  eventCount: number
  nextEvent: TimelineEvent | null
  lastActivityAt: string | null
}

export interface ItemDetail extends ItemSummary {
  timeline: TimelineEvent[]
  messages: MessageSummary[]
}

export interface ItemInput {
  company: string
  companyDomain?: string | null
  role?: string | null
  location?: string | null
  workMode?: WorkMode | null
  source?: string | null
  jobUrl?: string | null
  compensationNote?: string | null
  statusKey?: string
  descriptionMd?: string | null
  descriptionSource?: DescriptionSource | null
  contactName?: string | null
  contactEmail?: string | null
}

export type ItemPatch = Partial<ItemInput> & {
  closeReason?: CloseReason | null
}

export interface ItemQuery {
  statusKey?: string
  /** Matches company / company_domain / role. */
  query?: string
  includeArchived?: boolean
  limit?: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * timeline
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TimelineEvent {
  id: number
  itemId: number
  kind: TimelineEventKind
  title: string
  bodyMd: string | null
  /** Past events. Mutually exclusive-ish with startsAt, but both may be set. */
  occurredAt: string | null
  startsAt: string | null
  endsAt: string | null
  tz: string | null
  location: string | null
  meetingUrl: string | null
  /** FK into messages.id (not the RFC Message-ID header). */
  messageId: number | null
  icsUid: string | null
  icsSequence: number | null
  source: TimelineEventSource
  /** Set when a newer .ics SEQUENCE replaced this event. */
  supersededBy: number | null
  createdAt: string
}

export interface TimelineEventInput {
  itemId: number
  kind: TimelineEventKind
  title: string
  bodyMd?: string | null
  occurredAt?: string | null
  startsAt?: string | null
  endsAt?: string | null
  tz?: string | null
  location?: string | null
  meetingUrl?: string | null
  messageId?: number | null
  icsUid?: string | null
  icsSequence?: number | null
  source?: TimelineEventSource
}

/** "Up next" row: a future event plus just enough of its item to render. */
export interface UpcomingEvent extends TimelineEvent {
  item: Pick<Item, 'id' | 'company' | 'role' | 'statusKey'>
}

/**
 * What the .ics parser returns per VEVENT. Unit-tested.
 * Times are normalized to ISO-8601 UTC; `tz` keeps the original TZID for display.
 */
export interface ParsedIcsEvent {
  uid: string | null
  sequence: number | null
  method: string | null
  status: string | null
  summary: string | null
  description: string | null
  location: string | null
  startsAt: string | null
  endsAt: string | null
  tz: string | null
  organizer: EmailAddress | null
  attendees: EmailAddress[]
  meetingUrl: string | null
  isCancelled: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
 * prefilter (pure, unit-tested)
 * ──────────────────────────────────────────────────────────────────────────── */

export type PrefilterReasonCode =
  | 'ats_domain'
  | 'known_company_domain'
  | 'thread_linked'
  | 'subject_keyword'
  | 'body_keyword'
  | 'careers_sender'
  | 'meeting_signal'
  | 'newsletter_penalty'

export interface PrefilterReason {
  code: PrefilterReasonCode
  weight: number
  /** Human-readable specifics: the matched domain, keyword, meeting host, etc. */
  detail?: string
}

/** Exactly the fields the prefilter is allowed to look at. Keep it this narrow. */
export interface PrefilterMessage {
  fromAddr: string | null
  fromDomain: string | null
  subject: string | null
  bodyText: string | null
  bodyHtml: string | null
  threadKey: string | null
  listUnsubscribe: string | null
  attachments: Array<Pick<Attachment, 'filename' | 'mimeType' | 'isCalendar'>>
}

export interface PrefilterContext {
  /** company_domain of every non-archived item. */
  itemDomains: ReadonlySet<string>
  /** thread_key of every message already linked to an item — the strongest signal. */
  linkedThreadKeys: ReadonlySet<string>
  /** Defaults to PREFILTER_THRESHOLD_DEFAULT. */
  threshold?: number
}

export interface PrefilterResult {
  score: number
  reasons: PrefilterReason[]
  isCandidate: boolean
}

export type PrefilterFn = (message: PrefilterMessage, ctx: PrefilterContext) => PrefilterResult

/**
 * Lowered from 0.5. At 0.5 a message needed a known ATS sender or a tracked company just
 * to be looked at; at 0.35 a single body phrase or a careers sender is enough. Reading a
 * few extra messages is cheap. Missing an application confirmation is not.
 */
export const PREFILTER_THRESHOLD_DEFAULT = 0.35

/**
 * Tuned for RECALL, not precision. A message the agent never sees is invisible forever;
 * a message it reads and dismisses costs a few seconds. So every threshold decision here
 * errs toward letting mail through.
 *
 * body_keyword carries 0.5 on its own — enough to clear the threshold unaided — because
 * the single most common shape of hiring mail is a bland subject ("Thank you for your
 * interest in Datadog") wrapped around an unmistakable body ("we have received your
 * application for the Staff Engineer, Compute job"). Scoring subjects alone missed those
 * entirely.
 */
export const PREFILTER_WEIGHTS: Readonly<Record<PrefilterReasonCode, number>> = {
  ats_domain: 0.5,
  known_company_domain: 0.6,
  thread_linked: 0.9,
  subject_keyword: 0.3,
  body_keyword: 0.5,
  careers_sender: 0.35,
  meeting_signal: 0.3,
  // Softened from -0.4: real ATS mail is bulk mail and carries List-Unsubscribe too.
  // This should nudge, never veto.
  newsletter_penalty: -0.15
}

export const ATS_DOMAINS: readonly string[] = [
  'greenhouse.io',
  'us.greenhouse-mail.io',
  'greenhouse-mail.io',
  'lever.co',
  'hire.lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'workday.com',
  'workable.com',
  'smartrecruiters.com',
  'teamtailor.com',
  'recruitee.com',
  'jobvite.com',
  'icims.com',
  'taleo.net',
  'bamboohr.com',
  'breezy.hr'
]

export const MEETING_URL_HOSTS: readonly string[] = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com'
]

export const SUBJECT_SIGNAL_PATTERN =
  /applicat|interview|position|role|recruit|candidat|opportunit|offer|hiring|screen|assessment|take.?home|onsite|thank you for (?:your interest|applying)|thanks for applying|we received|received your|your candidacy|join (?:our|the) team|career|talent|job/i

/**
 * Phrases that betray hiring mail from the body alone. Deliberately generous — see the
 * note on PREFILTER_WEIGHTS. Matched against plain text; HTML is tag-stripped first.
 */
export const BODY_SIGNAL_PATTERN =
  /thank(?:s| you)\s+for\s+(?:applying|your\s+(?:application|interest))|(?:we(?:'ve|\s+have)?\s+)?received\s+your\s+application|your\s+application\b|application\s+(?:for|to)\s+the\b|recruit(?:ing|ment)\s+team|talent\s+(?:acquisition|community|team)|hiring\s+(?:team|manager|process)|phone\s+screen|next\s+steps|schedule\s+(?:a|an)\s+(?:call|interview|chat|conversation)|we\s+regret\s+to\s+inform|move\s+forward\s+with\s+your|job\s+(?:application|opening|posting)|interview|candidate/i

/**
 * Sender local-parts that mean "this came from a careers pipeline". Intentionally does NOT
 * include no-reply / do-not-reply: those cover every transactional email ever sent, and the
 * body signal already catches the careers mail that uses them.
 */
export const CAREERS_SENDER_PATTERN =
  /^(?:careers?|jobs?|talent|recruit(?:ing|ment|er)?|hiring|apply|applications?|people(?:ops)?|hr)\b/i

/* ────────────────────────────────────────────────────────────────────────────
 * agent runs
 * ──────────────────────────────────────────────────────────────────────────── */

/** Raw stdout envelope from `claude -p --output-format json`. Wire shape — snake_case. */
export interface AgentEnvelope {
  type?: string
  subtype?: string
  is_error: boolean
  result: string
  session_id: string
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  usage?: Record<string, unknown>
  [key: string]: unknown
}

export type AgentErrorKind =
  /** FIRST-CLASS UI STATE, not an edge case. See CLAUDE_NOT_SIGNED_IN_MESSAGE. */
  | 'not_signed_in'
  | 'cli_missing'
  | 'spawn_failed'
  | 'timeout'
  | 'stopped'
  | 'bad_output'
  | 'unknown'

/** Substring that appears in envelope.result when the CLI has no credentials. */
export const CLAUDE_AUTH_ERROR_MARKER = 'Failed to authenticate'
export const CLAUDE_NOT_SIGNED_IN_MESSAGE =
  "Claude Code isn't signed in — run `claude` in a terminal to log in"
/** Codex reports the same condition as a 401 from api.openai.com. Same remedy shape. */
export const CODEX_NOT_SIGNED_IN_MESSAGE =
  "Codex isn't signed in — run `codex` in a terminal to log in"

const NOT_SIGNED_IN_MESSAGES: Record<AgentEngine, string> = {
  claude: CLAUDE_NOT_SIGNED_IN_MESSAGE,
  codex: CODEX_NOT_SIGNED_IN_MESSAGE
}

/**
 * The signed-out copy for one engine. Both halves matter: the banner splits on the
 * em-dash to get a title and a remedy, so keep the "<product> isn't signed in — run
 * `<binary>` in a terminal to log in" shape for anything added here.
 */
export function agentNotSignedInMessage(engine: AgentEngine): string {
  return NOT_SIGNED_IN_MESSAGES[engine] ?? CLAUDE_NOT_SIGNED_IN_MESSAGE
}

export interface AgentRun {
  id: number
  kind: AgentRunKind
  startedAt: string
  finishedAt: string | null
  /** argv actually spawned, from command_json. */
  command: string[] | null
  model: string | null
  sessionId: string | null
  exitCode: number | null
  isError: boolean
  errorText: string | null
  /** Derived at read time from errorText / rawEnvelope. Not a column. */
  errorKind: AgentErrorKind | null
  durationMs: number | null
  costUsd: number | null
  rawEnvelope: AgentEnvelope | null
  /** agent_run_messages — the per-run READ ALLOWLIST. */
  messageIds: number[]
  proposalCount: number
}

export type AgentRunSummary = Omit<AgentRun, 'rawEnvelope' | 'messageIds'>

export interface StartRunInput {
  kind: AgentRunKind
  /** triage only. Omit to use every message currently in triage_state='candidate'. */
  messageIds?: number[]
  /** enrich only — the ONLY input an enrich run gets. No message data, ever. */
  company?: string
  /** enrich only — where the returned description lands once accepted. */
  itemId?: number
  /** Overrides AppSettings.model for this run. */
  model?: string
}

/** Live state pushed to the toolbar RUN button while a run is in flight. */
export interface AgentRunUpdate {
  runId: number
  kind: AgentRunKind
  state: AgentRunState
  startedAt: string
  elapsedMs: number
  /** e.g. "list_messages" — drives the "current tool call" text on the button. */
  currentTool: string | null
  toolCalls: number
  proposalCount: number
  /** Messages in this run's allowlist — the denominator of the progress bar. */
  messagesTotal: number
  /** DISTINCT messages the agent has actually opened. Re-reads do not double count. */
  messagesRead: number
  errorKind: AgentErrorKind | null
  errorText: string | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * proposals (every agent write lands here first)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * MCP wire payloads. snake_case ON PURPOSE — these are the literal argument objects the
 * agent passes to propose_* tools, stored verbatim in proposals.payload_json.
 * `ref` is a client-side id like "new:1" so a new item and its first event can be proposed
 * together; the applier resolves refs to real ids at accept time.
 */
export interface CreateItemProposalPayload {
  ref: string
  company: string
  company_domain?: string | null
  role?: string | null
  location?: string | null
  work_mode?: WorkMode | null
  source?: string | null
  job_url?: string | null
  description_md?: string | null
  contact_name?: string | null
  contact_email?: string | null
  status_key?: string
}

export interface ItemFieldPatch {
  company?: string
  company_domain?: string | null
  role?: string | null
  location?: string | null
  work_mode?: WorkMode | null
  source?: string | null
  job_url?: string | null
  compensation_note?: string | null
  description_md?: string | null
  contact_name?: string | null
  contact_email?: string | null
}

export interface UpdateItemProposalPayload {
  item_id: number
  fields: ItemFieldPatch
}

export interface SetStatusProposalPayload {
  item_id?: number
  ref?: string
  status_key: string
  close_reason?: CloseReason | null
}

export interface AddEventProposalPayload {
  item_id?: number
  ref?: string
  kind: TimelineEventKind
  title: string
  body_md?: string | null
  occurred_at?: string | null
  starts_at?: string | null
  ends_at?: string | null
  tz?: string | null
  location?: string | null
  meeting_url?: string | null
  source?: TimelineEventSource
  ics_uid?: string | null
  ics_sequence?: number | null
  message_id?: number | null
}

export interface LinkMessageProposalPayload {
  item_id?: number
  ref?: string
  message_id: number
}

export interface ProposalPayloadMap {
  create_item: CreateItemProposalPayload
  update_item: UpdateItemProposalPayload
  set_status: SetStatusProposalPayload
  add_event: AddEventProposalPayload
  link_message: LinkMessageProposalPayload
}

export interface ProposalBase {
  id: number
  runId: number
  /** Client-side id from the agent, e.g. "new:1". Null when the proposal targets a real row. */
  ref: string | null
  targetItemId: number | null
  targetEventId: number | null
  confidence: number | null
  rationale: string | null
  state: ProposalState
  decidedAt: string | null
  createdAt: string
}

/** Discriminated on `kind`. */
export type Proposal = {
  [K in ProposalKind]: ProposalBase & { kind: K; payload: ProposalPayloadMap[K] }
}[ProposalKind]

export type ProposalOf<K extends ProposalKind> = Extract<Proposal, { kind: K }>

/** One card in the Review queue: the proposal plus everything needed to judge it. */
export interface ProposalCard {
  proposal: Proposal
  /** Resolved target item. Null for create_item. */
  item: Item | null
  /** Sibling proposals sharing the same `ref` — accept/reject them together. */
  related: Proposal[]
  /** Source messages from the run allowlist, carrying prefilterReasons for "why flagged?". */
  messages: MessageSummary[]
  run: AgentRunSummary
}

export interface ProposalQuery {
  state?: ProposalState
  runId?: number
  limit?: number
}

export interface ProposalDecisionResult {
  proposalId: number
  state: ProposalState
  createdItemId: number | null
  createdEventId: number | null
  /** Proposals invalidated by this decision (same ref / same target). */
  supersededProposalIds: number[]
  error: string | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * sync
 * ──────────────────────────────────────────────────────────────────────────── */

export type SyncPhase =
  | 'idle'
  | 'connecting'
  | 'listing'
  | 'fetching'
  | 'parsing'
  | 'prefiltering'
  | 'done'
  | 'error'

export interface SyncStatus {
  phase: SyncPhase
  accountId: number | null
  processed: number
  total: number
  newMessages: number
  newCandidates: number
  lastSyncAt: string | null
  error: string | null
}

export interface SyncResult {
  accountId: number
  newMessages: number
  newCandidates: number
  durationMs: number
  error: string | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * settings / app shell
 * ──────────────────────────────────────────────────────────────────────────── */

export const AGENT_MODELS = ['sonnet', 'opus', 'haiku'] as const
export type AgentModel = (typeof AGENT_MODELS)[number]

export interface AppSettings {
  prefilterThreshold: number
  /** Claude model name. Codex is not given a model and uses its own default. */
  model: string
  /** Which CLI the agent bridge spawns. */
  agentEngine: AgentEngine
  /** 'claude' means "find it on PATH"; an absolute path pins it. */
  claudeBinaryPath: string
  /** 'codex' means "find it on PATH"; an absolute path pins it. */
  codexBinaryPath: string
  /** Enrichment (WebSearch) runs are OFF by default. */
  enrichmentEnabled: boolean
  blockRemoteImages: boolean
  syncIntervalMinutes: number
  maxCandidatesPerRun: number
  theme: ThemePreference
  setupDismissed: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  prefilterThreshold: PREFILTER_THRESHOLD_DEFAULT,
  model: 'sonnet',
  agentEngine: 'claude',
  claudeBinaryPath: 'claude',
  codexBinaryPath: 'codex',
  enrichmentEnabled: false,
  blockRemoteImages: true,
  syncIntervalMinutes: 10,
  maxCandidatesPerRun: 250,
  theme: 'system',
  setupDismissed: false
}

export interface AppInfo {
  version: string
  electronVersion: string
  platform: string
  userDataPath: string
  dbPath: string
  /** The engine these two fields describe — AppSettings.agentEngine, echoed back. */
  agentEngine: AgentEngine
  /** false => the agent bridge cannot run at all; show the sign-in / install state. */
  agentCliAvailable: boolean
  /** Account-setup guide. Per-provider anchors: `${setupGuideUrl}#gmail`. */
  setupGuideUrl: string
}

/** Badge counts for the left rail + RUN button pill. */
export interface AppCounts {
  candidates: number
  pendingProposals: number
  unreadInbox: number
  upcomingEvents: number
  items: number
}

/** Drives the first-run checklist: add account -> sync -> first scan -> review. */
export interface SetupState {
  hasAccount: boolean
  hasSynced: boolean
  hasRun: boolean
  hasReviewed: boolean
  complete: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
 * main -> renderer events
 * ──────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────────
 * UPDATES
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `available` means a newer version exists — NOT that it will install itself.
 * Recruit is unsigned, and Squirrel.Mac will not apply an update to an unsigned
 * bundle, so the app offers a download instead. See src/main/update.
 */
export type UpdateState = 'idle' | 'checking' | 'available' | 'current' | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  latestVersion?: string
  notes?: string
  downloadUrl?: string
  checkedAt?: string
  error?: string
}

export interface RecruitEvents {
  syncStatus: SyncStatus
  runUpdate: AgentRunUpdate
  proposalsChanged: { pending: number }
  mailChanged: { accountId: number; newMessages: number; newCandidates: number }
  itemsChanged: { itemIds: number[] }
  settingsChanged: AppSettings
  updateAvailable: UpdateStatus
}

export type RecruitEventName = keyof RecruitEvents
export type Unsubscribe = () => void

/* ────────────────────────────────────────────────────────────────────────────
 * THE IPC CONTRACT
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Everything the renderer can do. Exposed on `window.recruit` by the preload.
 * Every method except `on` is an ipcRenderer.invoke round-trip; failures reject.
 */
export interface RecruitApi {
  // ── app / settings ────────────────────────────────────────────────────────
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getCounts(): Promise<AppCounts>
  getSetupState(): Promise<SetupState>
  /** Opens in the OS browser. The renderer must never navigate itself. */
  openExternal(url: string): Promise<void>

  // ── accounts ──────────────────────────────────────────────────────────────
  listAccounts(): Promise<Account[]>
  getAccount(accountId: number): Promise<Account | null>
  saveAccount(input: AccountInput): Promise<Account>
  deleteAccount(accountId: number): Promise<void>
  testConnection(input: ConnectionTestInput): Promise<ConnectionTestResult>

  // ── mail (READ-ONLY in v1: no compose, no reply, no flag writes) ──────────
  syncNow(accountId?: number): Promise<SyncResult>
  cancelSync(): Promise<void>
  getSyncStatus(): Promise<SyncStatus>
  listMessages(query: MessageQuery): Promise<MessageListPage>
  getMessage(messageId: number): Promise<Message | null>
  getMessageHtml(messageId: number, allowRemoteImages: boolean): Promise<SanitizedBody>
  setTriageState(messageIds: number[], state: TriageState): Promise<void>
  /** Local read state only: this never sends \Seen to the server. */
  markMessagesRead(messageIds: number[], read: boolean): Promise<void>
  /**
   * Local SOFT delete: the row is kept and filtered out of every read, so nothing that links
   * to it dangles and the next sync cannot resurrect it. Pass false to undelete.
   */
  deleteMessages(messageIds: number[], deleted: boolean): Promise<void>
  /** Re-runs the prefilter over stored messages, e.g. after the threshold changes. */
  rescorePrefilter(): Promise<{ scored: number; candidates: number }>

  // ── tracker ───────────────────────────────────────────────────────────────
  listStatuses(): Promise<Status[]>
  listItems(query?: ItemQuery): Promise<ItemSummary[]>
  getItem(itemId: number): Promise<ItemDetail | null>
  createItem(input: ItemInput): Promise<Item>
  updateItem(itemId: number, patch: ItemPatch): Promise<Item>
  setItemStatus(itemId: number, statusKey: string, closeReason?: CloseReason | null): Promise<Item>
  archiveItem(itemId: number, archived: boolean): Promise<Item>
  deleteItem(itemId: number): Promise<void>
  linkMessage(itemId: number, messageId: number): Promise<void>
  unlinkMessage(itemId: number, messageId: number): Promise<void>

  // ── timeline ──────────────────────────────────────────────────────────────
  listUpcomingEvents(limit?: number): Promise<UpcomingEvent[]>
  addEvent(input: TimelineEventInput): Promise<TimelineEvent>
  updateEvent(eventId: number, patch: Partial<TimelineEventInput>): Promise<TimelineEvent>
  deleteEvent(eventId: number): Promise<void>

  // ── review queue ──────────────────────────────────────────────────────────
  listProposals(query?: ProposalQuery): Promise<ProposalCard[]>
  acceptProposal(proposalId: number): Promise<ProposalDecisionResult>
  rejectProposal(proposalId: number): Promise<ProposalDecisionResult>
  acceptProposals(proposalIds: number[]): Promise<ProposalDecisionResult[]>
  rejectProposals(proposalIds: number[]): Promise<ProposalDecisionResult[]>

  // ── agent ─────────────────────────────────────────────────────────────────
  getCandidateCount(): Promise<number>
  startRun(input: StartRunInput): Promise<AgentRunSummary>
  stopRun(runId: number): Promise<void>
  getActiveRun(): Promise<AgentRunUpdate | null>
  getRun(runId: number): Promise<AgentRun | null>
  listRuns(limit?: number): Promise<AgentRunSummary[]>

  // ── updates ───────────────────────────────────────────────────────────────
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdate(): Promise<UpdateStatus>
  /** Opens the DMG for this machine's architecture in the browser. */
  openDownload(): Promise<void>

  // ── main -> renderer push ─────────────────────────────────────────────────
  /** Returns an unsubscribe fn. Call it in a useEffect cleanup. */
  on<K extends RecruitEventName>(
    event: K,
    listener: (payload: RecruitEvents[K]) => void
  ): Unsubscribe
}

/** Every RecruitApi member that is an invoke round-trip (i.e. all but `on`). */
export type RecruitInvokeMethod = Exclude<keyof RecruitApi, 'on'>

/**
 * Channel names. Both preload and main MUST build channels with these helpers —
 * never hardcode a string.
 */
export const ipcChannel = (method: RecruitInvokeMethod): string => `recruit:${method}`
export const eventChannel = (event: RecruitEventName): string => `recruit:event:${event}`

/** The exhaustive method list the preload iterates over. */
export const IPC_METHODS = [
  'getAppInfo',
  'getSettings',
  'updateSettings',
  'getCounts',
  'getSetupState',
  'openExternal',
  'listAccounts',
  'getAccount',
  'saveAccount',
  'deleteAccount',
  'testConnection',
  'syncNow',
  'cancelSync',
  'getSyncStatus',
  'listMessages',
  'getMessage',
  'getMessageHtml',
  'setTriageState',
  'markMessagesRead',
  'deleteMessages',
  'rescorePrefilter',
  'listStatuses',
  'listItems',
  'getItem',
  'createItem',
  'updateItem',
  'setItemStatus',
  'archiveItem',
  'deleteItem',
  'linkMessage',
  'unlinkMessage',
  'listUpcomingEvents',
  'addEvent',
  'updateEvent',
  'deleteEvent',
  'listProposals',
  'acceptProposal',
  'rejectProposal',
  'acceptProposals',
  'rejectProposals',
  'getCandidateCount',
  'startRun',
  'stopRun',
  'getActiveRun',
  'getRun',
  'listRuns',
  'getUpdateStatus',
  'checkForUpdate',
  'openDownload'
] as const satisfies readonly RecruitInvokeMethod[]

export const EVENT_NAMES = [
  'syncStatus',
  'runUpdate',
  'proposalsChanged',
  'mailChanged',
  'itemsChanged',
  'settingsChanged',
  'updateAvailable'
] as const satisfies readonly RecruitEventName[]

/**
 * Compile-time guard: if you add a method to RecruitApi and forget IPC_METHODS,
 * this line stops typechecking. Add the name above to fix it.
 */
export type MissingIpcMethods = Exclude<RecruitInvokeMethod, (typeof IPC_METHODS)[number]>
export const IPC_METHODS_ARE_EXHAUSTIVE: [MissingIpcMethods] extends [never] ? true : never = true

export type MissingEventNames = Exclude<RecruitEventName, (typeof EVENT_NAMES)[number]>
export const EVENT_NAMES_ARE_EXHAUSTIVE: [MissingEventNames] extends [never] ? true : never = true

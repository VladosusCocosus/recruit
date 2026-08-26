/**
 * zod schemas for every tracker MCP tool. The raw shapes are handed straight to
 * McpServer.registerTool({ inputSchema }), so these ARE the wire contract the model sees.
 *
 * Field names are snake_case on purpose — propose_* arguments are stored verbatim in
 * proposals.payload_json and must match the *ProposalPayload types in @shared/types.
 */
import { z } from 'zod'

/* ── shared field vocabulary ─────────────────────────────────────────────── */

const confidence = z
  .number()
  .min(0)
  .max(1)
  .describe('Honest 0..1 confidence. Below 0.5 means "a human should look at this".')

const rationale = z
  .string()
  .min(1)
  .describe('One or two sentences: which message said what, and why this follows from it.')

const ref = z
  .string()
  .min(1)
  .describe(
    'Client-side id for an item you are proposing in THIS run but that does not exist yet, e.g. "new:1". Use the same ref across proposals to tie them to one new item.'
  )

const itemId = z.number().int().positive().describe('items.id of an existing tracker item.')

const messageId = z
  .number()
  .int()
  .positive()
  .describe('messages.id from list_messages. Must be inside this run’s allowlist.')

const workMode = z.enum(['onsite', 'hybrid', 'remote'])
const closeReason = z.enum(['rejected', 'withdrawn', 'accepted', 'ghosted'])
const eventKind = z.enum(['email', 'status_change', 'meeting', 'note', 'task'])
const eventSource = z.enum(['agent', 'user', 'ics'])
const statusKey = z
  .enum(['saved', 'applied', 'screening', 'interviewing', 'offer', 'closed'])
  .describe('Pipeline stage. Use "closed" together with close_reason for rejections.')

const isoDateTime = z
  .string()
  .describe('ISO-8601 timestamp. Prefer UTC ("2026-08-26T15:00:00Z"); include the offset.')

/* ── READ tools ──────────────────────────────────────────────────────────── */

/** list_messages takes no arguments — the allowlist is fixed by the run. */
export const listMessagesShape = {} as const

export const getMessageShape = {
  message_id: messageId
} as const

export const listItemsShape = {
  status: statusKey.optional().describe('Filter to one pipeline stage.'),
  query: z.string().optional().describe('Free text over company / domain / role.')
} as const

export const getItemShape = {
  item_id: itemId
} as const

export const searchItemsShape = {
  query: z.string().min(1).describe('Company name, email domain, or role title.')
} as const

/* ── PROPOSE tools ───────────────────────────────────────────────────────── */

export const proposeCreateItemShape = {
  ref,
  company: z.string().min(1).describe('The hiring company — never the ATS vendor.'),
  company_domain: z
    .string()
    .nullish()
    .describe('Bare domain, no scheme, e.g. "acme.com". Not greenhouse.io.'),
  role: z.string().nullish().describe('Job title as written in the email.'),
  location: z.string().nullish(),
  work_mode: workMode.nullish(),
  source: z.string().nullish().describe('Where it came from, e.g. "LinkedIn", "Greenhouse".'),
  job_url: z.string().nullish(),
  description_md: z
    .string()
    .nullish()
    .describe('Short markdown brief on the company and the role. See the system prompt.'),
  contact_name: z.string().nullish(),
  contact_email: z.string().nullish(),
  status_key: statusKey.optional().describe('Defaults to "applied" when omitted.'),
  confidence,
  rationale
} as const

export const itemFieldsShape = {
  company: z.string().optional(),
  company_domain: z.string().nullish(),
  role: z.string().nullish(),
  location: z.string().nullish(),
  work_mode: workMode.nullish(),
  source: z.string().nullish(),
  job_url: z.string().nullish(),
  compensation_note: z.string().nullish(),
  description_md: z.string().nullish(),
  contact_name: z.string().nullish(),
  contact_email: z.string().nullish()
} as const

export const proposeUpdateItemShape = {
  item_id: itemId,
  fields: z
    .object(itemFieldsShape)
    .describe('Only the fields you are actually changing. Omit everything else.'),
  confidence,
  rationale
} as const

export const proposeSetStatusShape = {
  item_id: itemId.optional(),
  ref: ref.optional(),
  status_key: statusKey,
  close_reason: closeReason.nullish().describe('Required when status_key is "closed".'),
  confidence,
  rationale
} as const

export const proposeAddEventShape = {
  item_id: itemId.optional(),
  ref: ref.optional(),
  kind: eventKind,
  title: z.string().min(1).describe('Short headline, e.g. "Phone screen with Dana".'),
  body_md: z.string().nullish(),
  occurred_at: isoDateTime.nullish().describe('For something that already happened.'),
  starts_at: isoDateTime.nullish().describe('For something scheduled.'),
  ends_at: isoDateTime.nullish(),
  tz: z.string().nullish().describe('IANA zone of the original invite, e.g. "America/New_York".'),
  location: z.string().nullish(),
  meeting_url: z.string().nullish(),
  source: eventSource.optional().describe('Defaults to "agent".'),
  message_id: messageId.optional().describe('The message this event came from.'),
  confidence,
  rationale
} as const

export const proposeLinkMessageShape = {
  item_id: itemId.optional(),
  ref: ref.optional(),
  message_id: messageId,
  confidence: confidence.optional(),
  rationale: rationale.optional()
} as const

/* ── inferred arg types ──────────────────────────────────────────────────── */

export type GetMessageArgs = z.infer<z.ZodObject<typeof getMessageShape>>
export type ListItemsArgs = z.infer<z.ZodObject<typeof listItemsShape>>
export type GetItemArgs = z.infer<z.ZodObject<typeof getItemShape>>
export type SearchItemsArgs = z.infer<z.ZodObject<typeof searchItemsShape>>
export type ProposeCreateItemArgs = z.infer<z.ZodObject<typeof proposeCreateItemShape>>
export type ProposeUpdateItemArgs = z.infer<z.ZodObject<typeof proposeUpdateItemShape>>
export type ProposeSetStatusArgs = z.infer<z.ZodObject<typeof proposeSetStatusShape>>
export type ProposeAddEventArgs = z.infer<z.ZodObject<typeof proposeAddEventShape>>
export type ProposeLinkMessageArgs = z.infer<z.ZodObject<typeof proposeLinkMessageShape>>

/** Bare tool names. The CLI sees them prefixed as mcp__tracker__<name>. */
export const TRACKER_TOOL_NAMES = [
  'list_messages',
  'get_message',
  'list_items',
  'get_item',
  'search_items',
  'propose_create_item',
  'propose_update_item',
  'propose_set_status',
  'propose_add_event',
  'propose_link_message'
] as const

export type TrackerToolName = (typeof TRACKER_TOOL_NAMES)[number]

export const MCP_SERVER_NAME = 'tracker'

/** What --allowedTools must list for a triage run. */
export const TRACKER_ALLOWED_TOOLS: readonly string[] = TRACKER_TOOL_NAMES.map(
  (n) => `mcp__${MCP_SERVER_NAME}__${n}`
)

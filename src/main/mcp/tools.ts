/**
 * The tools a user's own AI client sees. Every one of them reads; there is no write tool
 * on this server, and the handle underneath it is query-only besides.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  itemDigest,
  MAX_BODY_TEXT_CHARS,
  messageDigest,
  truncate,
  UNTRUSTED_LIST_NOTE,
  UNTRUSTED_MESSAGE_NOTE
} from '@shared/digests'
import {
  countItems,
  countItemsByStatus,
  getItemWithTimeline,
  listItemMessages,
  listItems
} from '../db/repos/items'
import { countMessages, getMessage, listMessages } from '../db/repos/messages'
import { upcomingEvents } from '../db/repos/timeline'
import {
  getApplicationShape,
  getMessageShape,
  getStatsShape,
  getUpcomingShape,
  listApplicationsShape,
  searchMessagesShape,
  type GetApplicationArgs,
  type GetMessageArgs,
  type GetUpcomingArgs,
  type ListApplicationsArgs,
  type SearchMessagesArgs
} from './schemas'

export const SERVER_NAME = 'jobbox'
export const SERVER_VERSION = '1.0.0'

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }]
})

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
  isError: true
})

/**
 * Returns the reason this server cannot answer right now, or null when it can. Consulted
 * before every tool body, so a database that goes away and a switch the user flips both
 * surface as a tool error rather than a dead process.
 */
export type Guard = () => string | null

export function createTrackerServer(guard: Guard): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  )

  const read = <A>(fn: (args: A) => ToolResult) =>
    async (args: A): Promise<ToolResult> => {
      const blocked = guard()
      return blocked ? fail(blocked) : fn(args)
    }

  server.registerTool(
    'list_applications',
    {
      title: 'List job applications',
      description:
        'The job applications tracked in Jobbox: company, role, pipeline stage, next scheduled event and when each last moved. Filter by stage or free text.',
      inputSchema: listApplicationsShape,
      annotations: { readOnlyHint: true }
    },
    read((args: ListApplicationsArgs) => {
      const rows = listItems({
        ...(args.status ? { statusKey: args.status } : {}),
        ...(args.query ? { query: args.query } : {}),
        ...(args.include_archived ? { includeArchived: true } : {}),
        limit: args.limit ?? 200
      })
      return ok({ count: rows.length, applications: rows.map(itemDigest) })
    })
  )

  server.registerTool(
    'get_application',
    {
      title: 'Read one application',
      description:
        'One application with its full timeline — interviews, calls, notes and tasks — and the ids of the emails linked to it.',
      inputSchema: getApplicationShape,
      annotations: { readOnlyHint: true }
    },
    read((args: GetApplicationArgs) => {
      const item = getItemWithTimeline(args.item_id)
      if (!item) return fail(`Application ${args.item_id} not found.`)
      return ok({
        ...itemDigest(item),
        description_md: item.descriptionMd,
        contact_name: item.contactName,
        contact_email: item.contactEmail,
        compensation_note: item.compensationNote,
        timeline: item.timeline.map((e) => ({
          event_id: e.id,
          kind: e.kind,
          title: e.title,
          body_md: e.bodyMd,
          occurred_at: e.occurredAt,
          starts_at: e.startsAt,
          ends_at: e.endsAt,
          tz: e.tz,
          location: e.location,
          meeting_url: e.meetingUrl,
          outcome: e.outcome,
          source: e.source
        })),
        answers: item.answers.map((a) => ({ question: a.question, answer: a.answerMd })),
        linked_message_ids: item.messages.map((m) => m.id)
      })
    })
  )

  server.registerTool(
    'search_messages',
    {
      title: 'Search email',
      description:
        'Emails Jobbox has synced, newest first. Returns digests without bodies — call get_message for the text of one. Pass item_id to see only what is linked to an application.',
      inputSchema: searchMessagesShape,
      annotations: { readOnlyHint: true }
    },
    read((args: SearchMessagesArgs) => {
      const limit = args.limit ?? 50
      const rows = args.item_id
        ? listItemMessages(args.item_id).slice(0, limit)
        : listMessages({ ...(args.query ? { search: args.query } : {}), limit }).rows
      return ok({
        count: rows.length,
        untrusted: UNTRUSTED_LIST_NOTE,
        messages: rows.map(messageDigest)
      })
    })
  )

  server.registerTool(
    'get_message',
    {
      title: 'Read one email',
      description: 'Headers, body text and attachment list for one email.',
      inputSchema: getMessageShape,
      annotations: { readOnlyHint: true }
    },
    read((args: GetMessageArgs) => {
      const m = getMessage(args.message_id)
      if (!m) return fail(`Message ${args.message_id} not found.`)
      return ok({
        ...messageDigest(m),
        untrusted: UNTRUSTED_MESSAGE_NOTE,
        to: m.to,
        cc: m.cc,
        list_unsubscribe: m.listUnsubscribe,
        body_text: truncate(m.bodyText ?? m.bodyHtml, MAX_BODY_TEXT_CHARS),
        attachments: m.attachments.map((a) => ({
          filename: a.filename,
          mime_type: a.mimeType,
          size: a.size,
          is_calendar: a.isCalendar
        }))
      })
    })
  )

  server.registerTool(
    'get_upcoming',
    {
      title: 'List upcoming events',
      description:
        'Every scheduled interview, call and task still ahead, soonest first, with the application each belongs to.',
      inputSchema: getUpcomingShape,
      annotations: { readOnlyHint: true }
    },
    read((args: GetUpcomingArgs) =>
      ok({
        events: upcomingEvents(args.limit ?? 50).map((e) => ({
          event_id: e.id,
          kind: e.kind,
          title: e.title,
          starts_at: e.startsAt,
          ends_at: e.endsAt,
          tz: e.tz,
          location: e.location,
          meeting_url: e.meetingUrl,
          item_id: e.item.id,
          company: e.item.company,
          role: e.item.role,
          status_key: e.item.statusKey
        }))
      })
    )
  )

  server.registerTool(
    'get_stats',
    {
      title: 'Job search summary',
      description:
        'Counts across the pipeline: applications per stage, the archived total, and how much mail Jobbox holds.',
      inputSchema: getStatsShape,
      annotations: { readOnlyHint: true }
    },
    read(() => {
      const byStatus = countItemsByStatus()
      const live = countItems(false)
      return ok({
        applications_by_status: byStatus,
        applications: live,
        archived: countItems(true) - live,
        messages_stored: countMessages(),
        upcoming_events: upcomingEvents(500).length
      })
    })
  )

  return server
}

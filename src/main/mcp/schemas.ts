/**
 * zod shapes for the user-facing MCP tools. The raw shapes go straight to
 * McpServer.registerTool({ inputSchema }), so these are the contract the client sees.
 */
import { z } from 'zod'

const limit = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).optional().describe(`How many rows to return (default ${fallback}).`)

const statusKey = z
  .enum(['saved', 'applied', 'screening', 'interviewing', 'offer', 'closed'])
  .describe('Pipeline stage.')

export const listApplicationsShape = {
  status: statusKey.optional(),
  query: z.string().optional().describe('Free text over company, email domain and role.'),
  include_archived: z.boolean().optional().describe('Archived applications are left out by default.'),
  limit: limit(500, 200)
} as const

export const getApplicationShape = {
  item_id: z.number().int().positive().describe('items.id, as returned by list_applications.')
} as const

export const searchMessagesShape = {
  query: z.string().optional().describe('Free text over subject, sender and snippet.'),
  item_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Restrict to the emails linked to one application.'),
  limit: limit(200, 50)
} as const

export const getMessageShape = {
  message_id: z.number().int().positive().describe('messages.id, as returned by search_messages.')
} as const

export const getUpcomingShape = {
  limit: limit(200, 50)
} as const

export const getStatsShape = {} as const

export type ListApplicationsArgs = z.infer<z.ZodObject<typeof listApplicationsShape>>
export type GetApplicationArgs = z.infer<z.ZodObject<typeof getApplicationShape>>
export type SearchMessagesArgs = z.infer<z.ZodObject<typeof searchMessagesShape>>
export type GetMessageArgs = z.infer<z.ZodObject<typeof getMessageShape>>
export type GetUpcomingArgs = z.infer<z.ZodObject<typeof getUpcomingShape>>

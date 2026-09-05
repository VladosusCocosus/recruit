/**
 * The data layer. Everything main-process touches SQLite through here.
 *
 *   import * as db from '@main/db'
 *   db.openDatabase()                       // userData/recruit.db, WAL, migrations, seed
 *   const page = db.listMessages({ ... })
 *
 * Startup order in src/main/index.ts: openDatabase() must run before any IPC handler is
 * registered, and checkpoint()/closeDatabase() belong in `before-quit`.
 *
 * Layout:
 *   connection.ts        open/close, PRAGMAs, migrations, prepared-statement cache, helpers
 *   migrations/          001_init.ts — the whole schema + statuses seed (PRAGMA user_version)
 *   rows.ts              row shapes + THE row -> domain mappers (rowToAccount, rowToMessage, …)
 *   repos/*.ts           typed queries, one file per table group
 *   applyProposal.ts     the accept path: proposals -> live rows, with "new:N" ref resolution
 */

export * from './connection'
export * from './migrations'
export * from './rows'

export * from './repos/accounts'
export * from './repos/messages'
export * from './repos/items'
export * from './repos/resumes'
export * from './repos/timeline'
export * from './repos/proposals'
export * from './repos/runs'
export * from './repos/kv'
export * from './repos/app'

export * from './applyProposal'

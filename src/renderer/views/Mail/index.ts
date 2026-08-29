/**
 * Mail views.
 *
 * The shell's VIEWS registry in App.tsx wants the two default exports:
 *   import InboxView from './views/Mail/InboxView'
 *   import CandidatesView from './views/Mail/CandidatesView'
 */

export { default as InboxView } from './InboxView'
export { default as CandidatesView } from './CandidatesView'

export { MailView } from './MailView'
export type { MailViewProps } from './MailView'

export { MessageList } from './MessageList'
export type { MessageListProps } from './MessageList'

export { MessageReader } from './MessageReader'
export type { MessageReaderProps } from './MessageReader'

export { MessageRow } from './MessageRow'
export type { MessageRowProps } from './MessageRow'

export { MessageMenu, messageMenuTargetFromEvent } from './MessageMenu'
export type { MessageMenuActions, MessageMenuTarget } from './MessageMenu'

export { WhyFlagged } from './WhyFlagged'
export { AttachmentChips } from './AttachmentChips'

export { useMessages, PAGE_SIZE } from './useMessages'
export type { MailMode, UseMessagesResult } from './useMessages'
export { useMessageBody } from './useMessageBody'
export { useActiveRun, useBlockRemoteImages, useDebounced } from './hooks'

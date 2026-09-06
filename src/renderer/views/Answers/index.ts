/**
 * Application questions — the same list, before and after the application exists.
 *
 *   useAnswers(context)  the store. `{ kind: 'item' }` persists through IPC;
 *                        `{ kind: 'draft' }` holds the questions for `applyDraft`.
 *   <Answers store={…}>  the cards and the composer, without section chrome.
 *
 * There is no rail destination: questions belong to an application, not to a place.
 * Importing this barrel pulls in the stylesheet.
 */

import './answers.css'

export { Answers } from './Answers'
export { useAnswers } from './useAnswers'
export type { AnswerCard, AnswersContext, AnswersStore } from './useAnswers'

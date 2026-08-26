import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_NAMES,
  IPC_METHODS,
  eventChannel,
  ipcChannel,
  type RecruitApi,
  type RecruitEventName,
  type RecruitEvents,
  type Unsubscribe
} from '@shared/types'

/**
 * Every RecruitApi method except `on` becomes
 *   ipcRenderer.invoke('recruit:<methodName>', ...args)
 * Built from IPC_METHODS so the bridge can never fall out of sync with the contract
 * (src/shared/types.ts has a compile-time exhaustiveness guard on that list).
 */
const invokers = Object.fromEntries(
  IPC_METHODS.map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(ipcChannel(method), ...args)
  ])
) as unknown as Omit<RecruitApi, 'on'>

function subscribe<K extends RecruitEventName>(
  event: K,
  listener: (payload: RecruitEvents[K]) => void
): Unsubscribe {
  if (!(EVENT_NAMES as readonly string[]).includes(event)) {
    throw new Error(`Unknown Recruit event: ${String(event)}`)
  }
  const channel = eventChannel(event)
  const handler = (_e: IpcRendererEvent, payload: RecruitEvents[K]): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * Per-event sugar over `on`, generated from EVENT_NAMES so it also cannot drift:
 *   onSyncStatus, onRunUpdate, onProposalsChanged, onMailChanged, onItemsChanged,
 *   onSettingsChanged — each returning the same unsubscribe fn as `on`.
 *
 * NOTE: `src/renderer/env.d.ts` declares `window.recruit` as plain `RecruitApi`, so these
 * exist at runtime but are invisible to the renderer's types until that declaration is
 * widened to `RecruitApi & RecruitEventSubscriptions`. `on(event, fn)` is the typed path.
 */
export type RecruitEventSubscriptions = {
  [K in RecruitEventName as `on${Capitalize<K>}`]: (
    listener: (payload: RecruitEvents[K]) => void
  ) => Unsubscribe
}

const subscriptions = Object.fromEntries(
  EVENT_NAMES.map((event) => [
    `on${event.charAt(0).toUpperCase()}${event.slice(1)}`,
    (listener: (payload: RecruitEvents[RecruitEventName]) => void) => subscribe(event, listener)
  ])
) as unknown as RecruitEventSubscriptions

const api: RecruitApi & RecruitEventSubscriptions = {
  ...invokers,
  ...subscriptions,
  on: subscribe
}

contextBridge.exposeInMainWorld('recruit', api)

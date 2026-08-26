/**
 * The typed ipcMain <-> RecruitApi seam. Moved here verbatim from the scaffold's
 * flat src/main/ipc.ts so `@main/ipc` can be a directory.
 *
 * Channels are ALWAYS built with ipcChannel()/eventChannel(). Never hardcode a string —
 * the preload builds its half from the same helpers.
 */
import { BrowserWindow, ipcMain } from 'electron'
import {
  eventChannel,
  ipcChannel,
  type RecruitApi,
  type RecruitEventName,
  type RecruitEvents,
  type RecruitInvokeMethod
} from '@shared/types'

/**
 * Register a typed handler for one RecruitApi method. Args and return type are
 * checked against the shared contract, so main and renderer cannot drift.
 *
 *   handle('listItems', async (query) => db.listItems(query))
 */
export function handle<M extends RecruitInvokeMethod>(
  method: M,
  fn: (
    ...args: Parameters<RecruitApi[M]>
  ) => ReturnType<RecruitApi[M]> | Awaited<ReturnType<RecruitApi[M]>>
): void {
  ipcMain.removeHandler(ipcChannel(method))
  ipcMain.handle(ipcChannel(method), (_event, ...args: unknown[]) =>
    fn(...(args as Parameters<RecruitApi[M]>))
  )
}

/** Push an event to every open window. Payload type is checked against RecruitEvents. */
export function broadcast<K extends RecruitEventName>(event: K, payload: RecruitEvents[K]): void {
  const channel = eventChannel(event)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

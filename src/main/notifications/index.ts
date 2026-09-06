/**
 * Native notifications and the dock badge.
 *
 * Two kinds of notification, on two different mechanisms:
 *
 *   - Scheduled — interview reminders and debrief prompts. `schedule.ts` decides what is
 *     owed and when; this file owns one re-arming timer that sleeps until the next
 *     moment. One timer rather than one per event, so a tracker full of interviews costs
 *     the same as an empty one and a reschedule cannot leak a stale timer.
 *   - Reactive — a finished agent run with proposals to review. Raised at the call site.
 *
 * macOS has no API to request notification authorization ahead of time: the system prompt
 * appears when the app posts its first notification. So nothing is posted until the
 * first-run checklist has been answered, and `notifyEnabled` gates every path.
 */
import { app, BrowserWindow, Notification } from 'electron'
import * as db from '@main/db'
import { getSettings } from '@main/settings'
import type { AppSettings, NavKey } from '@shared/types'
import { broadcast } from '@main/ipc/bridge'
import {
  debriefReminders,
  dueReminders,
  interviewReminders,
  nextWakeAt,
  reminderKey,
  type Reminder
} from './schedule'

/** Longest a single timer may sleep. setTimeout overflows past ~24.8 days. */
const MAX_TIMEOUT_MS = 6 * 3_600_000

export interface Notifier {
  /** Recompute the schedule and fire anything already due. Cheap; call it freely. */
  refresh(): void
  /** A finished run left `count` proposals waiting. Silent when the window is focused. */
  proposalsReady(count: number): void
  /** Post the one-off confirmation that answers "did that work?" after the first-run yes. */
  confirmEnabled(): void
  dispose(): void
}

function focusWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
  if (!win) return null
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

function windowIsFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused())
}

function post(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  if (onClick) notification.on('click', onClick)
  notification.show()
}

/** Bring the window forward and send the renderer to a route. */
function openAt(nav: NavKey, itemId?: number): void {
  focusWindow()
  broadcast('navigateTo', itemId === undefined ? { nav } : { nav, itemId })
}

export function createNotifier(): Notifier {
  /** Keys of reminders already posted this session. */
  const fired = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let disposed = false

  function settings(): AppSettings {
    return getSettings()
  }

  function enabled(): boolean {
    return settings().notificationsAsked
  }

  function collect(): Reminder[] {
    const s = settings()
    const out: Reminder[] = []
    if (s.notifyInterviews) out.push(...interviewReminders(db.upcomingEvents(200), s.notifyLeadMinutes))
    if (s.notifyDebriefs) out.push(...debriefReminders(db.debriefCandidates()))
    return out
  }

  function setBadge(): void {
    if (process.platform !== 'darwin' || !app.dock) return
    const counts = db.getAppCounts()
    const waiting = counts.pendingProposals + counts.pendingDebriefs
    app.dock.setBadge(waiting > 0 ? String(waiting) : '')
  }

  function show(reminder: Reminder): void {
    post(reminder.title, reminder.body, () =>
      openAt(reminder.kind === 'debrief' ? 'upnext' : 'board', reminder.itemId)
    )
  }

  function refresh(): void {
    if (disposed) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    setBadge()
    if (!enabled()) return

    let reminders: Reminder[]
    try {
      reminders = collect()
    } catch (error) {
      console.error('[notifications] could not read the schedule:', error)
      return
    }

    const now = Date.now()
    for (const reminder of dueReminders(reminders, fired, now)) {
      fired.add(reminderKey(reminder))
      show(reminder)
    }

    const next = nextWakeAt(reminders, fired, now)
    if (next === null) return
    // Re-arm rather than sleep the whole way: a Mac that sleeps through the moment wakes
    // to a timer that fires late, and the expiry rules in schedule.ts then discard it.
    timer = setTimeout(refresh, Math.min(next - now, MAX_TIMEOUT_MS))
  }

  return {
    refresh,

    proposalsReady(count: number): void {
      setBadge()
      if (count <= 0 || !enabled() || !settings().notifyProposals) return
      // The Review pill already updates live in front of you; a banner would be noise.
      if (windowIsFocused()) return
      post(
        count === 1 ? '1 proposal to review' : `${count} proposals to review`,
        'Jobbox read your mail and has changes to suggest.',
        () => openAt('review')
      )
    },

    confirmEnabled(): void {
      // The first notification Jobbox ever posts. On macOS this is what raises the system
      // permission prompt, which is why it happens here, right after the user says yes.
      post('Notifications are on', 'Interview reminders, debrief prompts and review alerts.')
    },

    dispose(): void {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

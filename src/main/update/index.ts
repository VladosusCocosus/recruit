/**
 * Update checking.
 *
 * Recruit ships UNSIGNED — there is no Apple Developer certificate — and Squirrel.Mac
 * refuses to apply an update to an unsigned bundle. So this module deliberately does not
 * install anything: it asks the update server what the latest version is, and if we are
 * behind, tells the renderer to show a banner offering a download.
 *
 * The silent path is a drop-in later. Once the app is signed and notarized, swap
 * `openDownload` for electron-updater pointed at
 *   `${feedBase()}/updates/darwin/${process.arch}`
 * which is already served, already per-arch, and needs no server change.
 */
import { app, shell } from 'electron'
import type { UpdateStatus } from '@shared/types'

const DEFAULT_FEED = 'https://recruit-updates.fly.dev'
const DEFAULT_SETUP_SITE = 'https://jobbox.fline.sh'
const CHECK_DELAY_MS = 10_000 // let the window paint before touching the network
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8_000

type Listener = (status: UpdateStatus) => void

let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }
let listeners: Listener[] = []
let timer: NodeJS.Timeout | null = null

export function feedBase(): string {
  return (process.env.RECRUIT_UPDATE_FEED || DEFAULT_FEED).replace(/\/+$/, '')
}

/**
 * The account-setup guide: a static site on its own host, deliberately not behind the
 * update feed — a mail-setup problem should stay readable when that service is down.
 *
 * This returns the GUIDE PAGE, not the site origin. The per-provider anchors the
 * account form appends (#gmail, #icloud, #fastmail, #outlook, plus #custom and
 * #trouble) exist only on /setup; pointing this at the origin sent everyone to the
 * marketing landing page with a fragment that matched nothing.
 *
 * `RECRUIT_SETUP_URL` is therefore the full guide URL in dev — e.g.
 * `http://localhost:8080/setup` — and must be http(s): `openExternal` refuses every
 * other scheme, so a file: path silently does nothing.
 */
export function setupGuideUrl(): string {
  return (process.env.RECRUIT_SETUP_URL || `${DEFAULT_SETUP_SITE}/setup`).replace(/\/+$/, '')
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function onUpdateStatus(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

function emit(next: UpdateStatus): UpdateStatus {
  status = next
  for (const fn of listeners) fn(status)
  return status
}

interface LatestPayload {
  version?: string
  tag?: string
  notes?: string
  published_at?: string
  assets?: Array<{ name: string; arch: string; kind: string; size: number; url: string }>
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const currentVersion = app.getVersion()
  emit({ ...status, state: 'checking', currentVersion })

  const controller = new AbortController()
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${feedBase()}/api/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`update server returned ${res.status}`)

    const body = (await res.json()) as LatestPayload
    const latestVersion = (body.version || '').trim()
    if (!latestVersion) throw new Error('update server returned no version')

    const behind = compareSemver(latestVersion, currentVersion) > 0
    const dmg = (body.assets || []).find((a) => a.kind === 'dmg' && a.arch === process.arch)

    return emit({
      state: behind ? 'available' : 'current',
      currentVersion,
      latestVersion,
      notes: body.notes || undefined,
      downloadUrl: dmg?.url || `${feedBase()}/download/latest?arch=${process.arch}`,
      checkedAt: new Date().toISOString()
    })
  } catch (err) {
    // A missing or sleeping update server must never be louder than a passing note —
    // it has nothing to do with whether the app works.
    return emit({
      state: 'error',
      currentVersion,
      latestVersion: status.latestVersion,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err)
    })
  } finally {
    clearTimeout(abort)
  }
}

export async function openDownload(): Promise<void> {
  const url = status.downloadUrl || `${feedBase()}/download/latest?arch=${process.arch}`
  await shell.openExternal(url)
}

export function startUpdateChecks(): void {
  if (timer) return
  setTimeout(() => void checkForUpdate(), CHECK_DELAY_MS)
  timer = setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
  timer.unref?.()
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Returns >0 when a is newer. Prerelease tags sort below their release, per semver. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-', 2)
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
    while (nums.length < 3) nums.push(0)
    return { nums, pre }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

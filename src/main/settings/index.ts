/**
 * App settings: a small JSON file in userData, read once and cached.
 *
 * The stored shape is a superset of the shared `AppSettings` (which is what
 * crosses IPC). Nothing is main-process-only any more: syncBackfillDays was the last
 * such key and moved to `AppSettings` once Settings grew a control for it, so
 * MainSettings is now just an alias kept for the call sites that name it.
 *
 * How the agent process is spawned is NOT configurable here. It used to be — a
 * `{{placeholder}}` argv template lived in this file, unread by the runner, and it
 * could never have expressed Codex anyway (repeated `-c key=value` overrides, a
 * bearer token that must travel by environment variable rather than argv). The one
 * mechanism is now AgentEngineAdapter in src/main/agent/engines.ts; this file only
 * decides WHICH engine and WHERE its binary lives.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { constants as FS, accessSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import {
  AGENT_ENGINES,
  AGENT_ENGINE_BINARY,
  DEFAULT_SETTINGS,
  type AgentEngine,
  type AppSettings,
  type ThemePreference
} from '@shared/types'

/* ────────────────────────────────────────────────────────────────────────────
 * shape
 * ──────────────────────────────────────────────────────────────────────────── */

export type MainSettings = AppSettings

export const DEFAULT_MAIN_SETTINGS: MainSettings = { ...DEFAULT_SETTINGS }

/* ────────────────────────────────────────────────────────────────────────────
 * store
 * ──────────────────────────────────────────────────────────────────────────── */

const SETTINGS_FILE = 'settings.json'
const THEMES: ThemePreference[] = ['system', 'light', 'dark']

let pathOverride: string | null = null
let cached: MainSettings | null = null

/** Test/embedding hook. Pass null to go back to <userData>/settings.json. */
export function setSettingsPath(path: string | null): void {
  pathOverride = path
  cached = null
}

export function settingsPath(): string {
  return pathOverride ?? join(app.getPath('userData'), SETTINGS_FILE)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/** Coerces anything read off disk (or sent from the renderer) into a valid shape. */
export function normalizeSettings(raw: unknown): MainSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_MAIN_SETTINGS
  return {
    prefilterThreshold: num(r['prefilterThreshold'], d.prefilterThreshold, 0, 5),
    model: str(r['model'], d.model),
    agentEngine: AGENT_ENGINES.includes(r['agentEngine'] as AgentEngine)
      ? (r['agentEngine'] as AgentEngine)
      : d.agentEngine,
    claudeBinaryPath: str(r['claudeBinaryPath'], d.claudeBinaryPath),
    codexBinaryPath: str(r['codexBinaryPath'], d.codexBinaryPath),
    enrichmentEnabled: bool(r['enrichmentEnabled'], d.enrichmentEnabled),
    blockRemoteImages: bool(r['blockRemoteImages'], d.blockRemoteImages),
    syncIntervalMinutes: num(r['syncIntervalMinutes'], d.syncIntervalMinutes, 0, 1440),
    maxCandidatesPerRun: num(r['maxCandidatesPerRun'], d.maxCandidatesPerRun, 1, 1000),
    theme: THEMES.includes(r['theme'] as ThemePreference) ? (r['theme'] as ThemePreference) : d.theme,
    setupDismissed: bool(r['setupDismissed'], d.setupDismissed),
    syncBackfillDays: num(r['syncBackfillDays'], d.syncBackfillDays, 1, 3650)
  }
}

/** Whole settings object. Cheap after the first call. */
export function getSettings(): MainSettings {
  if (cached) return cached
  const path = settingsPath()
  let raw: unknown = {}
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      raw = {} // corrupt file -> defaults, and the next write repairs it
    }
  }
  cached = normalizeSettings(raw)
  return cached
}

/** One key, typed. */
export function getSetting<K extends keyof MainSettings>(key: K): MainSettings[K] {
  return getSettings()[key]
}

/** Merges a patch, writes atomically, returns the new full settings. */
export function updateSettings(patch: Partial<MainSettings>): MainSettings {
  const next = normalizeSettings({ ...getSettings(), ...patch })
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, path)
  cached = next
  if ('claudeBinaryPath' in patch) binaryCache.delete('claude')
  if ('codexBinaryPath' in patch) binaryCache.delete('codex')
  return next
}

export function setSetting<K extends keyof MainSettings>(
  key: K,
  value: MainSettings[K]
): MainSettings {
  return updateSettings({ [key]: value } as Partial<MainSettings>)
}

export function resetSettings(): MainSettings {
  return updateSettings(DEFAULT_MAIN_SETTINGS)
}

/* ────────────────────────────────────────────────────────────────────────────
 * claude binary resolution
 *
 * An Electron app launched from Finder/Dock inherits launchd's PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin) — NOT the user's shell PATH. A bare 'claude'
 * therefore fails in the packaged app even though it works in a terminal. So:
 * check the configured path, then process.env.PATH, then a list of the places
 * the installers actually put it.
 * ──────────────────────────────────────────────────────────────────────────── */

export type AgentBinarySource = 'setting' | 'path' | 'fallback' | 'unresolved'

export interface AgentBinaryResolution {
  /** Always spawnable-as-is: an absolute path when found, else the raw setting. */
  path: string
  source: AgentBinarySource
  available: boolean
  /** Everything that was stat'd, for a "we looked here" diagnostic in Settings. */
  searched: string[]
}

/** Which settings key holds each engine's override. */
const BINARY_PATH_KEY: Record<AgentEngine, 'claudeBinaryPath' | 'codexBinaryPath'> = {
  claude: 'claudeBinaryPath',
  codex: 'codexBinaryPath'
}

/**
 * Node version managers install into a per-version directory, so the bin dir for
 * an npm global like `codex` is only knowable by listing them. Missing dirs and
 * unreadable ones are simply not candidates.
 */
function versionManagerBinDirs(): string[] {
  const home = homedir()
  const roots = [
    join(home, '.nvm', 'versions', 'node'),
    join(home, '.fnm', 'node-versions'),
    join(home, '.local', 'share', 'mise', 'installs', 'node'),
    join(home, '.asdf', 'installs', 'nodejs')
  ]
  const dirs: string[] = []
  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      // fnm nests one level deeper (<version>/installation/bin).
      dirs.push(join(root, entry, 'bin'), join(root, entry, 'installation', 'bin'))
    }
  }
  return dirs
}

/** Dirs a GUI-launched app is missing. Searched, and prepended to the spawn PATH. */
export function guiPathDirs(): string[] {
  const home = homedir()
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.bun', 'bin'),
    join(home, 'Library', 'pnpm'),
    join(home, '.yarn', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.deno', 'bin'),
    join(home, 'go', 'bin'),
    ...versionManagerBinDirs()
  ]
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, FS.X_OK)
    return true
  } catch {
    return false
  }
}

const binaryCache = new Map<AgentEngine, AgentBinaryResolution>()

/**
 * Resolves one engine's binary path setting to something spawnable. Cached per
 * engine; call with `{ force: true }` (or change the setting) to re-probe.
 */
export function resolveAgentBinary(
  engine: AgentEngine,
  options?: { force?: boolean }
): AgentBinaryResolution {
  const hit = binaryCache.get(engine)
  if (hit && !options?.force) return hit

  const configured = str(getSetting(BINARY_PATH_KEY[engine]), AGENT_ENGINE_BINARY[engine])
  const searched: string[] = []
  const settle = (r: AgentBinaryResolution): AgentBinaryResolution => {
    binaryCache.set(engine, r)
    return r
  }

  // 1. An explicit path in settings wins outright.
  if (isAbsolute(configured) || configured.startsWith('.') || configured.includes('/')) {
    searched.push(configured)
    const ok = isExecutableFile(configured)
    return settle({
      path: configured,
      source: ok ? 'setting' : 'unresolved',
      available: ok,
      searched
    })
  }

  // 2. A bare name: walk the inherited PATH ourselves (no shell, no `which`).
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, configured)
    searched.push(candidate)
    if (isExecutableFile(candidate)) {
      return settle({ path: candidate, source: 'path', available: true, searched })
    }
  }

  // 3. The GUI-launch case: the installers' well-known locations.
  for (const dir of guiPathDirs()) {
    const candidate = join(dir, configured)
    if (searched.includes(candidate)) continue
    searched.push(candidate)
    if (isExecutableFile(candidate)) {
      return settle({ path: candidate, source: 'fallback', available: true, searched })
    }
  }

  return settle({ path: configured, source: 'unresolved', available: false, searched })
}

/** Convenience for AppInfo.agentCliAvailable — the SELECTED engine's binary. */
export function isAgentCliAvailable(engine?: AgentEngine): boolean {
  return resolveAgentBinary(engine ?? getSetting('agentEngine')).available
}

/**
 * env for spawning the agent: the GUI dirs prepended to PATH so anything the
 * CLI itself shells out to (node, git, ripgrep) is also found.
 */
export function agentSpawnEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const current = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  const merged = [...guiPathDirs(), ...current, '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const seen = new Set<string>()
  const path = merged.filter((d) => (seen.has(d) ? false : (seen.add(d), true))).join(delimiter)
  return { ...process.env, ...extra, PATH: path }
}

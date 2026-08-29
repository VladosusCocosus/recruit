/**
 * App settings: a small JSON file in userData, read once and cached.
 *
 * The stored shape is a superset of the shared `AppSettings` (which is what
 * crosses IPC) plus one main-process-only key: agentCommandTemplate, the argv the
 * agent bridge spawns. claudeBinaryPath and syncBackfillDays used to live here too;
 * both are on `AppSettings` now that Settings has controls for them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { constants as FS, accessSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type AppSettings, type ThemePreference } from '@shared/types'

/* ────────────────────────────────────────────────────────────────────────────
 * shape
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How the agent process is spawned. Swapping this is how "or another agent"
 * is supported — point `command` at a different binary and reshape `args`.
 * Placeholders are `{{name}}`; see renderAgentCommand().
 */
export interface AgentCommandTemplate {
  command: string
  args: string[]
}

/** The claude CLI 2.1.x invocation. Every value comes from the run, not here. */
export const DEFAULT_AGENT_COMMAND_TEMPLATE: AgentCommandTemplate = {
  command: '{{binary}}',
  args: [
    '-p',
    '{{prompt}}',
    '--system-prompt',
    '{{systemPrompt}}',
    '--tools',
    '{{tools}}',
    '--strict-mcp-config',
    '--mcp-config',
    '{{mcpConfig}}',
    '--allowedTools',
    '{{allowedTools}}',
    '--permission-mode',
    'bypassPermissions',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--model',
    '{{model}}'
  ]
}

/**
 * The renderer now owns claudeBinaryPath and syncBackfillDays (they are on
 * AppSettings), so the only thing left that main keeps to itself is the argv
 * template — the seam for pointing the bridge at something other than `claude`.
 */
export interface MainSettings extends AppSettings {
  agentCommandTemplate: AgentCommandTemplate
}

export const DEFAULT_MAIN_SETTINGS: MainSettings = {
  ...DEFAULT_SETTINGS,
  agentCommandTemplate: DEFAULT_AGENT_COMMAND_TEMPLATE
}

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

function template(value: unknown): AgentCommandTemplate {
  if (typeof value !== 'object' || value === null) return DEFAULT_AGENT_COMMAND_TEMPLATE
  const t = value as Partial<AgentCommandTemplate>
  const args = Array.isArray(t.args) && t.args.every((a) => typeof a === 'string') ? t.args : null
  if (!args || typeof t.command !== 'string' || t.command === '') {
    return DEFAULT_AGENT_COMMAND_TEMPLATE
  }
  return { command: t.command, args }
}

/** Coerces anything read off disk (or sent from the renderer) into a valid shape. */
export function normalizeSettings(raw: unknown): MainSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_MAIN_SETTINGS
  return {
    prefilterThreshold: num(r['prefilterThreshold'], d.prefilterThreshold, 0, 5),
    model: str(r['model'], d.model),
    enrichmentEnabled: bool(r['enrichmentEnabled'], d.enrichmentEnabled),
    blockRemoteImages: bool(r['blockRemoteImages'], d.blockRemoteImages),
    syncIntervalMinutes: num(r['syncIntervalMinutes'], d.syncIntervalMinutes, 0, 1440),
    maxCandidatesPerRun: num(r['maxCandidatesPerRun'], d.maxCandidatesPerRun, 1, 1000),
    theme: THEMES.includes(r['theme'] as ThemePreference) ? (r['theme'] as ThemePreference) : d.theme,
    setupDismissed: bool(r['setupDismissed'], d.setupDismissed),
    claudeBinaryPath: str(r['claudeBinaryPath'], d.claudeBinaryPath),
    syncBackfillDays: num(r['syncBackfillDays'], d.syncBackfillDays, 1, 3650),
    agentCommandTemplate: template(r['agentCommandTemplate'])
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
  if ('claudeBinaryPath' in patch) claudeCache = null
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

export type ClaudeBinarySource = 'setting' | 'path' | 'fallback' | 'unresolved'

export interface ClaudeBinaryResolution {
  /** Always spawnable-as-is: an absolute path when found, else the raw setting. */
  path: string
  source: ClaudeBinarySource
  available: boolean
  /** Everything that was stat'd, for a "we looked here" diagnostic in Settings. */
  searched: string[]
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
    join(home, 'go', 'bin')
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

let claudeCache: ClaudeBinaryResolution | null = null

/**
 * Resolves `claudeBinaryPath` to something spawnable. Cached; call with
 * `{ force: true }` (or change the setting) to re-probe.
 */
export function resolveClaudeBinary(options?: { force?: boolean }): ClaudeBinaryResolution {
  if (claudeCache && !options?.force) return claudeCache

  const configured = getSetting('claudeBinaryPath')
  const searched: string[] = []

  // 1. An explicit path in settings wins outright.
  if (isAbsolute(configured) || configured.startsWith('.') || configured.includes('/')) {
    searched.push(configured)
    const ok = isExecutableFile(configured)
    claudeCache = {
      path: configured,
      source: ok ? 'setting' : 'unresolved',
      available: ok,
      searched
    }
    return claudeCache
  }

  // 2. A bare name: walk the inherited PATH ourselves (no shell, no `which`).
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, configured)
    searched.push(candidate)
    if (isExecutableFile(candidate)) {
      claudeCache = { path: candidate, source: 'path', available: true, searched }
      return claudeCache
    }
  }

  // 3. The GUI-launch case: the installers' well-known locations.
  for (const dir of guiPathDirs()) {
    const candidate = join(dir, configured)
    if (searched.includes(candidate)) continue
    searched.push(candidate)
    if (isExecutableFile(candidate)) {
      claudeCache = { path: candidate, source: 'fallback', available: true, searched }
      return claudeCache
    }
  }

  claudeCache = { path: configured, source: 'unresolved', available: false, searched }
  return claudeCache
}

/** Convenience for AppInfo.claudeCliAvailable. */
export function isClaudeAvailable(): boolean {
  return resolveClaudeBinary().available
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

/* ────────────────────────────────────────────────────────────────────────────
 * command template rendering
 * ──────────────────────────────────────────────────────────────────────────── */

export type AgentCommandVars = Record<string, string | string[] | null | undefined>

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

function interpolate(text: string, vars: AgentCommandVars): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    const value = vars[name]
    if (value === null || value === undefined) return ''
    return Array.isArray(value) ? value.join(' ') : value
  })
}

/**
 * Expands a template into argv. An arg that is *exactly* one placeholder is
 * replaced by its value: an array splices in as multiple args, null/undefined
 * drops the arg entirely, and '' survives as an empty arg (that is how
 * `--tools ""` is expressed). Placeholders inside a larger string interpolate.
 */
export function renderAgentCommand(
  tpl: AgentCommandTemplate,
  vars: AgentCommandVars
): { command: string; args: string[] } {
  const args: string[] = []
  for (const arg of tpl.args) {
    const exact = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(arg)
    if (exact) {
      const value = vars[exact[1]]
      if (value === null || value === undefined) continue
      if (Array.isArray(value)) args.push(...value)
      else args.push(value)
      continue
    }
    args.push(interpolate(arg, vars))
  }
  return { command: interpolate(tpl.command, vars), args }
}

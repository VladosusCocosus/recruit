/**
 * Reading and writing one key inside an MCP client's JSON config — a file another
 * application owns.
 *
 * Every write merges into what is already there, copies the file to `<name>.jobbox.bak`
 * and replaces it by rename. A file that does not parse as a JSON object is never
 * rewritten.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ConfigFile = { mcpServers?: Record<string, unknown> } & Record<string, unknown>

export function readConfig(file: string): ConfigFile {
  if (!existsSync(file)) return {}
  const raw = readFileSync(file, 'utf8').trim()
  if (raw === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('the file is not a JSON object')
  }
  return parsed as ConfigFile
}

export function writeConfig(file: string, config: ConfigFile): void {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.jobbox.bak`)
  const tmp = `${file}.jobbox.tmp`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

export function hasServer(file: string, key: string): boolean {
  return Boolean(readConfig(file).mcpServers?.[key])
}

/** Adds or replaces one server entry, leaving every other key as it was. */
export function addServer(file: string, key: string, entry: unknown): void {
  const config = readConfig(file)
  config.mcpServers = { ...(config.mcpServers ?? {}), [key]: entry }
  writeConfig(file, config)
}

export function dropServer(file: string, key: string): void {
  const config = readConfig(file)
  if (config.mcpServers) {
    const { [key]: _dropped, ...rest } = config.mcpServers
    config.mcpServers = rest
  }
  writeConfig(file, config)
}

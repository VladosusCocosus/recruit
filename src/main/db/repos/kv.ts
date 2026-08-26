/**
 * Small key/value bag for app singletons (AppSettings lives here). Not part of the
 * authoritative schema — it exists so settings share the one DB writer instead of a
 * second persistence mechanism.
 */
import { execute, queryAll, queryOne } from '../connection'
import { nowIso, parseJson, toJson } from '../rows'

export function kvGet<T>(key: string, fallback: T): T {
  const row = queryOne<{ value_json: string | null }>(
    'SELECT value_json FROM app_kv WHERE key = ?',
    key
  )
  return row ? parseJson<T>(row.value_json, fallback) : fallback
}

export function kvSet(key: string, value: unknown): void {
  execute(
    `INSERT INTO app_kv (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    key,
    toJson(value),
    nowIso()
  )
}

export function kvDelete(key: string): void {
  execute('DELETE FROM app_kv WHERE key = ?', key)
}

export function kvKeys(): string[] {
  return queryAll<{ key: string }>('SELECT key FROM app_kv ORDER BY key').map((r) => r.key)
}

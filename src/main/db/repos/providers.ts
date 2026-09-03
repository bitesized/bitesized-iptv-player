import type { AppDatabase } from '@main/db'
import { decryptSecret, encryptSecret } from '@main/security/credentials'
import { redactUrl, redactText } from '@main/security/redact'
import type { Provider, ProviderStatus, ProviderType } from '@shared/types'

interface ProviderDbRow {
  id: number
  type: ProviderType
  name: string
  base_url: string | null
  username: string | null
  enc_password: Buffer | null
  enc_m3u_url: Buffer | null
  enc_epg_url: Buffer | null
  last_sync_at: number | null
  status: ProviderStatus
  status_message: string | null
  max_connections: number | null
}

/** Decrypt a stored URL, tolerating a keychain that can no longer read it. */
function readUrl(blob: Buffer | null): string | null {
  if (blob === null) return null
  try {
    return decryptSecret(blob)
  } catch {
    return null
  }
}

/**
 * The renderer's view of a provider. Playlist and EPG URLs are masked: the UI
 * only ever displays them, and in plaintext they are the whole subscription
 * credential. Main reads the real values via `getProviderUrls`.
 */
function toProvider(row: ProviderDbRow): Provider {
  const m3uUrl = readUrl(row.enc_m3u_url)
  const epgUrl = readUrl(row.enc_epg_url)
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    baseUrl: row.base_url,
    username: row.username,
    m3uUrl: m3uUrl === null ? null : redactUrl(m3uUrl),
    epgUrl: epgUrl === null ? null : redactUrl(epgUrl),
    hasEpgUrl: epgUrl !== null,
    lastSyncAt: row.last_sync_at,
    status: row.status,
    statusMessage: row.status_message,
    maxConnections: row.max_connections
  }
}

/** Plaintext provider URLs, for main-process use only — never send these to the renderer. */
export function getProviderUrls(
  db: AppDatabase,
  id: number
): { m3uUrl: string | null; epgUrl: string | null } {
  const row = db.prepare('SELECT enc_m3u_url, enc_epg_url FROM providers WHERE id = ?').get(id) as
    { enc_m3u_url: Buffer | null; enc_epg_url: Buffer | null } | undefined
  return {
    m3uUrl: readUrl(row?.enc_m3u_url ?? null),
    epgUrl: readUrl(row?.enc_epg_url ?? null)
  }
}

/** Every user-configured origin, so the stream proxy can trust them. */
export function listProviderOrigins(db: AppDatabase): string[] {
  const rows = db.prepare('SELECT id, base_url FROM providers').all() as {
    id: number
    base_url: string | null
  }[]
  const origins = rows.flatMap((row) => {
    const { m3uUrl, epgUrl } = getProviderUrls(db, row.id)
    return [row.base_url, m3uUrl, epgUrl].flatMap((value) => {
      if (value === null) return []
      try {
        return [new URL(value).origin]
      } catch {
        // Local playlist paths share the column and have no origin.
        return []
      }
    })
  })
  return [...new Set(origins)]
}

export function setProviderEpgUrl(db: AppDatabase, id: number, epgUrl: string | null): void {
  db.prepare('UPDATE providers SET enc_epg_url = ? WHERE id = ?').run(
    epgUrl === null ? null : encryptSecret(epgUrl),
    id
  )
}

export function listProviders(db: AppDatabase): Provider[] {
  const rows = db.prepare('SELECT * FROM providers ORDER BY id').all() as ProviderDbRow[]
  return rows.map(toProvider)
}

export function getProvider(db: AppDatabase, id: number): Provider | null {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as
    ProviderDbRow | undefined
  return row ? toProvider(row) : null
}

export function getProviderPassword(db: AppDatabase, id: number): Buffer | null {
  const row = db.prepare('SELECT enc_password FROM providers WHERE id = ?').get(id) as
    { enc_password: Buffer | null } | undefined
  return row?.enc_password ?? null
}

export function insertXtreamProvider(
  db: AppDatabase,
  input: { name: string; baseUrl: string; username: string; encPassword: Buffer }
): Provider {
  const result = db
    .prepare(
      `INSERT INTO providers (type, name, base_url, username, enc_password, status)
       VALUES ('xtream', ?, ?, ?, ?, 'never_synced')`
    )
    .run(input.name, input.baseUrl, input.username, input.encPassword)
  return getProvider(db, Number(result.lastInsertRowid))!
}

export function insertM3uProvider(
  db: AppDatabase,
  input: { name: string; m3uUrl: string | null; epgUrl: string | null }
): Provider {
  const result = db
    .prepare(
      `INSERT INTO providers (type, name, enc_m3u_url, enc_epg_url, status)
       VALUES ('m3u', ?, ?, ?, 'never_synced')`
    )
    .run(
      input.name,
      input.m3uUrl === null ? null : encryptSecret(input.m3uUrl),
      input.epgUrl === null ? null : encryptSecret(input.epgUrl)
    )
  return getProvider(db, Number(result.lastInsertRowid))!
}

export function deleteProvider(db: AppDatabase, id: number): void {
  db.prepare('DELETE FROM providers WHERE id = ?').run(id)
}

export function setProviderStatus(
  db: AppDatabase,
  id: number,
  status: ProviderStatus,
  message: string | null = null
): void {
  // Network and provider errors routinely quote the URL they failed on, and
  // this string is persisted and rendered in Settings — strip credentials.
  db.prepare('UPDATE providers SET status = ?, status_message = ? WHERE id = ?').run(
    status,
    message === null ? null : redactText(message),
    id
  )
}

export function markProviderSynced(db: AppDatabase, id: number): void {
  db.prepare(
    "UPDATE providers SET status = 'ok', status_message = NULL, last_sync_at = ? WHERE id = ?"
  ).run(Math.floor(Date.now() / 1000), id)
}

/** Persist the panel-reported concurrent-connection cap (null clears it). */
export function setProviderMaxConnections(
  db: AppDatabase,
  id: number,
  maxConnections: number | null
): void {
  db.prepare('UPDATE providers SET max_connections = ? WHERE id = ?').run(maxConnections, id)
}

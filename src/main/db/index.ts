import Database from 'better-sqlite3'
import { encryptSecret } from '@main/security/credentials'
import { migrations } from './migrations'

export type AppDatabase = Database.Database

/**
 * Open (or create) the app database with production pragmas and run any
 * pending migrations. Pass ':memory:' for tests.
 */
export function openDatabase(dbPath: string): AppDatabase {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  encryptLegacyProviderUrls(db)
  return db
}

/**
 * Move plaintext m3u_url/epg_url values written before migration 8 into the
 * encrypted columns. Encryption needs the OS keychain, which SQL can't reach,
 * so this runs as a code step after the schema migrations. It is a no-op once
 * every row has been converted — which is every open after the first.
 */
export function encryptLegacyProviderUrls(db: AppDatabase): void {
  const rows = db
    .prepare(
      `SELECT id, m3u_url, epg_url FROM providers
       WHERE (m3u_url IS NOT NULL AND enc_m3u_url IS NULL)
          OR (epg_url IS NOT NULL AND enc_epg_url IS NULL)`
    )
    .all() as { id: number; m3u_url: string | null; epg_url: string | null }[]
  if (rows.length === 0) return

  const update = db.prepare(
    `UPDATE providers
        SET enc_m3u_url = ?, enc_epg_url = ?, m3u_url = NULL, epg_url = NULL
      WHERE id = ?`
  )
  db.transaction(() => {
    for (const row of rows) {
      update.run(
        row.m3u_url === null ? null : encryptSecret(row.m3u_url),
        row.epg_url === null ? null : encryptSecret(row.epg_url),
        row.id
      )
    }
  })()
}

export function migrate(db: AppDatabase): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })
    apply()
  }
}

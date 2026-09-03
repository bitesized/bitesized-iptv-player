import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

describe('migrations', () => {
  it('applies all migrations and records user_version', () => {
    const db = openTestDb()
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(2)
  })

  it('creates the core tables', () => {
    const db = openTestDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name)

    for (const table of [
      'providers',
      'profiles',
      'categories',
      'channels',
      'vod',
      'series',
      'episodes',
      'epg_programmes',
      'favorites',
      'watch_history',
      'settings'
    ]) {
      expect(tables).toContain(table)
    }
  })

  it('is idempotent — migrating twice is a no-op', () => {
    const db = openTestDb()
    expect(() => migrate(db)).not.toThrow()
  })

  it('adds the providers.max_connections column (v4)', () => {
    const db = openTestDb()
    const cols = db
      .prepare('PRAGMA table_info(providers)')
      .all()
      .map((row) => (row as { name: string }).name)
    expect(cols).toContain('max_connections')
  })

  it('creates the partial browse-sort indexes (v7)', () => {
    const db = openTestDb()
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => (row as { name: string }).name)

    for (const index of [
      'idx_channels_by_num',
      'idx_channels_cat_num',
      'idx_vod_by_name',
      'idx_vod_cat_name',
      'idx_series_by_added',
      'idx_series_cat_added'
    ]) {
      expect(indexes).toContain(index)
    }
    // Superseded by the COLLATE NOCASE / DESC partial indexes above.
    expect(indexes).not.toContain('idx_vod_name')
    expect(indexes).not.toContain('idx_series_added')
  })

  it('keeps FTS in sync via triggers and searches with prefixes', () => {
    const db = openTestDb()
    db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Test')").run()
    db.prepare(
      "INSERT INTO vod (provider_id, stream_id, name) VALUES (1, '100', 'The Matrix')"
    ).run()

    const hit = db.prepare("SELECT rowid FROM vod_fts WHERE vod_fts MATCH 'matr*'").get() as
      { rowid: number } | undefined
    expect(hit).toBeDefined()

    db.prepare("UPDATE vod SET name = 'Inception' WHERE stream_id = '100'").run()
    const stale = db.prepare("SELECT rowid FROM vod_fts WHERE vod_fts MATCH 'matr*'").get()
    expect(stale).toBeUndefined()
    const fresh = db.prepare("SELECT rowid FROM vod_fts WHERE vod_fts MATCH 'incep*'").get()
    expect(fresh).toBeDefined()
  })

  it('enforces foreign keys with cascade on provider delete', () => {
    const db = openTestDb()
    db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Test')").run()
    db.prepare("INSERT INTO channels (provider_id, stream_id, name) VALUES (1, '1', 'CH1')").run()
    db.prepare('DELETE FROM providers WHERE id = 1').run()
    const count = db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }
    expect(count.n).toBe(0)
  })
})

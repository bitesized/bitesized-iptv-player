import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import { syncXtreamProvider } from '@main/services/xtream/sync'
import type { SyncProgress } from '@shared/types'

const creds = { baseUrl: 'http://panel.example:8080', username: 'u', password: 'p' }

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  db.prepare(
    "INSERT INTO providers (id, type, name, base_url, username) VALUES (1, 'xtream', 'T', ?, 'u')"
  ).run(creds.baseUrl)
  return db
}

describe('syncXtreamProvider', () => {
  let agent: MockAgent
  let previous: Dispatcher

  beforeEach(() => {
    previous = getGlobalDispatcher()
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    setGlobalDispatcher(previous)
    await agent.close()
  })

  function mockAction(action: string | null, body: unknown): void {
    agent
      .get('http://panel.example:8080')
      .intercept({
        path: (path) => {
          const url = new URL(path, 'http://panel.example:8080')
          return url.pathname === '/player_api.php' && url.searchParams.get('action') === action
        }
      })
      .reply(200, JSON.stringify(body), {
        headers: { 'content-type': 'application/json' }
      })
      .persist()
  }

  function mockHappyPanel(): void {
    mockAction(null, { user_info: { auth: 1 }, server_info: {} })
    mockAction('get_live_categories', [{ category_id: '1', category_name: 'News' }])
    mockAction('get_vod_categories', [{ category_id: '2', category_name: 'Action' }])
    mockAction('get_series_categories', [{ category_id: '3', category_name: 'Drama' }])
    mockAction('get_live_streams', [
      { stream_id: '11', name: 'CH1', category_id: '1', tv_archive: '1' },
      { stream_id: '12', name: 'CH2', category_id: '999' }, // unknown category
      { name: 'garbage row with no id' }
    ])
    mockAction('get_vod_streams', [
      { stream_id: '21', name: 'Movie A', category_id: '2', container_extension: 'mkv' }
    ])
    mockAction('get_series', [{ series_id: '31', name: 'Show A', category_id: '3' }])
  }

  it('imports categories, channels, vod and series, and reports stages', async () => {
    const db = openTestDb()
    mockHappyPanel()

    const stages: string[] = []
    await syncXtreamProvider(db, 1, creds, (p: Omit<SyncProgress, 'providerId'>) => {
      stages.push(p.stage)
    })

    expect(db.prepare('SELECT COUNT(*) n FROM categories').get()).toEqual({ n: 3 })
    expect(db.prepare('SELECT COUNT(*) n FROM channels WHERE deleted = 0').get()).toEqual({
      n: 2
    })
    expect(db.prepare('SELECT COUNT(*) n FROM vod').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) n FROM series').get()).toEqual({ n: 1 })

    // Channel in a known category is linked; unknown category → NULL.
    const linked = db
      .prepare(
        "SELECT c.name AS cat FROM channels ch LEFT JOIN categories c ON c.id = ch.category_id WHERE ch.stream_id = '11'"
      )
      .get() as { cat: string | null }
    expect(linked.cat).toBe('News')
    const unlinked = db
      .prepare("SELECT category_id FROM channels WHERE stream_id = '12'")
      .get() as { category_id: number | null }
    expect(unlinked.category_id).toBeNull()

    const provider = db
      .prepare('SELECT status, last_sync_at FROM providers WHERE id = 1')
      .get() as {
      status: string
      last_sync_at: number | null
    }
    expect(provider.status).toBe('ok')
    expect(provider.last_sync_at).not.toBeNull()

    expect(stages[0]).toBe('connecting')
    expect(stages.at(-1)).toBe('done')
    for (const stage of ['categories', 'live', 'vod', 'series']) {
      expect(stages).toContain(stage)
    }
  })

  it('marks the provider errored when auth fails', async () => {
    const db = openTestDb()
    mockAction(null, { user_info: { auth: 0, message: 'Invalid credentials' } })

    const stages: string[] = []
    await expect(syncXtreamProvider(db, 1, creds, (p) => stages.push(p.stage))).rejects.toThrow(
      /Authentication failed/
    )

    const provider = db
      .prepare('SELECT status, status_message FROM providers WHERE id = 1')
      .get() as {
      status: string
      status_message: string
    }
    expect(provider.status).toBe('error')
    expect(provider.status_message).toMatch(/Authentication failed/)
    expect(stages.at(-1)).toBe('error')
  })

  it('searches imported content via FTS immediately', async () => {
    const db = openTestDb()
    mockHappyPanel()
    await syncXtreamProvider(db, 1, creds, () => {})

    const hit = db
      .prepare(
        "SELECT v.name FROM vod_fts f JOIN vod v ON v.id = f.rowid WHERE vod_fts MATCH 'movi*'"
      )
      .get() as { name: string }
    expect(hit.name).toBe('Movie A')
  })
})

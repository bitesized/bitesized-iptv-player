// Performance guard for a huge catalog (100k+ items must stay
// smooth). These are coarse wall-clock budgets, deliberately generous — they
// exist to catch an *order of magnitude* regression (a lost index turning a
// keyset page into a full sort), not to benchmark the machine.

import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import {
  getChannelsByIds,
  listCategories,
  pageChannels,
  pageVod,
  search
} from '@main/db/repos/browse'

const CHANNELS = 100_000
const MOVIES = 100_000
const CATEGORIES = 200

function seed(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Bulk')").run()
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Default')").run()

  const category = db.prepare(
    'INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (?, 1, ?, ?, ?)'
  )
  const channel = db.prepare(
    'INSERT INTO channels (provider_id, category_id, stream_id, name, num, added_at) VALUES (1, ?, ?, ?, ?, ?)'
  )
  const movie = db.prepare(
    'INSERT INTO vod (provider_id, category_id, stream_id, name, added_at) VALUES (1, ?, ?, ?, ?)'
  )

  db.transaction(() => {
    for (let i = 1; i <= CATEGORIES; i++) {
      category.run(i, 'live', `l${i}`, `Live Category ${i}`)
      category.run(CATEGORIES + i, 'vod', `v${i}`, `Movie Category ${i}`)
    }
    for (let i = 0; i < CHANNELS; i++) {
      channel.run((i % CATEGORIES) + 1, `s${i}`, `Channel ${i} Sports`, i + 1, 1_700_000_000 + i)
    }
    for (let i = 0; i < MOVIES; i++) {
      movie.run(CATEGORIES + (i % CATEGORIES) + 1, `m${i}`, `Movie ${i} Action`, 1_700_000_000 + i)
    }
  })()
  // The sync worker runs `PRAGMA optimize` after every import; without stats the
  // planner mis-picks between the filter and sort indexes, so mirror that here.
  db.exec('ANALYZE')
  return db
}

function ms(fn: () => void): number {
  const started = performance.now()
  fn()
  return performance.now() - started
}

/** Table/index access strategy SQLite picked, one line per plan step. */
function plan(db: Database.Database, sql: string, args: unknown[] = []): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]
  return rows.map((r) => r.detail).join(' | ')
}

describe('100k-item catalog', () => {
  const db = seed()

  it('pages channels in the default (num) order without a full sort', () => {
    // Walk deep into the list: the last page must cost about the same as the
    // first, which is the whole point of keyset pagination.
    let cursor: string | null = null
    const firstPage = ms(() => {
      cursor = pageChannels(db, { limit: 60, cursor: null, providerId: 1 }).nextCursor
    })

    // Scroll to the end of the 100k catalog. Bigger pages keep the test quick;
    // what matters is that the *last* page costs like the first, i.e. the cursor
    // predicate seeks rather than re-reading everything before it.
    let lastPage = 0
    let pages = 1
    const walk = ms(() => {
      while (cursor !== null) {
        lastPage = ms(() => {
          cursor = pageChannels(db, { limit: 500, cursor, providerId: 1 }).nextCursor
        })
        pages++
      }
    })
    expect(pages).toBe(Math.ceil(CHANNELS / 500) + 1)
    expect(firstPage).toBeLessThan(20)
    expect(lastPage).toBeLessThan(20)
    expect(walk).toBeLessThan(1500)
  })

  it('pages a single category by name quickly', () => {
    let cursor: string | null = null
    const elapsed = ms(() => {
      for (let i = 0; i < 5; i++) {
        cursor = pageVod(db, { limit: 60, cursor, categoryId: 401, sort: 'name' }).nextCursor
      }
    })
    expect(elapsed).toBeLessThan(100)
  })

  it('pages everything by name and by recency quickly', () => {
    const byName = ms(() => {
      pageVod(db, { limit: 60, cursor: null, sort: 'name' })
    })
    const byAdded = ms(() => {
      pageVod(db, { limit: 60, cursor: null, categoryId: 'recent' })
    })
    expect(byName).toBeLessThan(100)
    expect(byAdded).toBeLessThan(100)
  })

  it('lists categories with item counts quickly', () => {
    const elapsed = ms(() => {
      expect(listCategories(db, 'vod', 1, 1)).toHaveLength(CATEGORIES)
    })
    expect(elapsed).toBeLessThan(200)
  })

  it('resolves a screenful of channels by id in one statement', () => {
    // What `epg:nowNext` does for the visible rows of the Live list.
    const ids = Array.from({ length: 500 }, (_, i) => i * 7 + 1)
    const elapsed = ms(() => {
      expect(getChannelsByIds(db, ids)).toHaveLength(500)
    })
    expect(elapsed).toBeLessThan(50)
  })

  it('searches 200k rows via FTS quickly', () => {
    const elapsed = ms(() => {
      const page = search(db, { term: 'Movie 4242', kind: 'vod', limit: 30, cursor: null })
      expect(page.items.length).toBeGreaterThan(0)
    })
    expect(elapsed).toBeLessThan(200)
  })

  it('serves browse queries from indexes, not table scans', () => {
    // A "SCAN <table>" (no index) here means the pager degraded into reading and
    // sorting the whole catalog for every page.
    const channelPlan = plan(
      db,
      'SELECT t.* FROM channels t WHERE t.deleted = 0 AND t.provider_id = ? ORDER BY (t.num) ASC NULLS LAST, t.id ASC LIMIT 60',
      [1]
    )
    expect(channelPlan).not.toMatch(/SCAN channels(?! USING)/)
    expect(channelPlan).not.toMatch(/USE TEMP B-TREE/)

    const vodPlan = plan(
      db,
      'SELECT t.* FROM vod t WHERE t.deleted = 0 AND t.category_id = ? ORDER BY (t.name COLLATE NOCASE) ASC NULLS LAST, t.id ASC LIMIT 60',
      [401]
    )
    expect(vodPlan).not.toMatch(/SCAN vod(?! USING)/)
    expect(vodPlan).not.toMatch(/USE TEMP B-TREE/)
  })
})

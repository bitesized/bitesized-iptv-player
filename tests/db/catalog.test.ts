import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import { upsertCategories, upsertChannels, upsertEpisodes, upsertVod } from '@main/db/repos/catalog'
import type { ChannelRow, VodRow } from '@main/services/xtream/normalize'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Test')").run()
  return db
}

function channel(streamId: string, name: string, categoryRemoteId: string | null): ChannelRow {
  return {
    streamId,
    name,
    logo: null,
    streamType: 'live',
    tvArchive: 0,
    epgChannelId: null,
    num: null,
    addedAt: null,
    categoryRemoteId
  }
}

describe('upsertCategories', () => {
  it('inserts, maps remote ids, and soft-deletes missing on re-sync', () => {
    const db = openTestDb()
    const first = upsertCategories(db, 1, 'live', [
      { remoteId: '10', name: 'News' },
      { remoteId: '20', name: 'Sports' }
    ])
    expect(first.size).toBe(2)

    const second = upsertCategories(db, 1, 'live', [{ remoteId: '10', name: 'News & Politics' }])
    expect(second.get('10')).toBe(first.get('10'))

    const rows = db
      .prepare('SELECT remote_id, name, deleted FROM categories ORDER BY remote_id')
      .all() as { remote_id: string; name: string; deleted: number }[]
    expect(rows).toEqual([
      { remote_id: '10', name: 'News & Politics', deleted: 0 },
      { remote_id: '20', name: 'Sports', deleted: 1 }
    ])
  })

  it('keeps kinds separate', () => {
    const db = openTestDb()
    upsertCategories(db, 1, 'live', [{ remoteId: '1', name: 'Live Cat' }])
    upsertCategories(db, 1, 'vod', [{ remoteId: '1', name: 'Vod Cat' }])
    const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }
    expect(count.n).toBe(2)
  })
})

describe('upsertChannels diff sync', () => {
  it('upserts, updates changed rows, soft-deletes removed, revives returning', () => {
    const db = openTestDb()
    const cats = upsertCategories(db, 1, 'live', [{ remoteId: '10', name: 'News' }])

    upsertChannels(db, 1, [channel('1', 'CH1', '10'), channel('2', 'CH2', null)], cats)
    let names = db.prepare('SELECT name, deleted FROM channels ORDER BY stream_id').all()
    expect(names).toEqual([
      { name: 'CH1', deleted: 0 },
      { name: 'CH2', deleted: 0 }
    ])

    // CH2 disappears, CH1 renamed.
    upsertChannels(db, 1, [channel('1', 'CH1 HD', '10')], cats)
    names = db.prepare('SELECT name, deleted FROM channels ORDER BY stream_id').all()
    expect(names).toEqual([
      { name: 'CH1 HD', deleted: 0 },
      { name: 'CH2', deleted: 1 }
    ])

    // CH2 comes back — same row is revived, not duplicated.
    upsertChannels(db, 1, [channel('1', 'CH1 HD', '10'), channel('2', 'CH2', null)], cats)
    const count = db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }
    expect(count.n).toBe(2)
    const ch2 = db.prepare("SELECT deleted FROM channels WHERE stream_id = '2'").get() as {
      deleted: number
    }
    expect(ch2.deleted).toBe(0)
  })

  it('reports batch progress', () => {
    const db = openTestDb()
    const rows = Array.from({ length: 4500 }, (_, i) => channel(String(i), `CH${i}`, null))
    const progress: number[] = []
    upsertChannels(db, 1, rows, new Map(), (n) => progress.push(n))
    expect(progress).toEqual([2000, 4000, 4500])
  })
})

describe('upsertVod', () => {
  it('handles a synthetic 50k-item catalog quickly', () => {
    const db = openTestDb()
    const rows: VodRow[] = Array.from({ length: 50_000 }, (_, i) => ({
      streamId: String(i),
      name: `Movie ${i}`,
      cover: null,
      rating: null,
      addedAt: i,
      containerExt: 'mkv',
      tmdbId: null,
      plot: null,
      durationSecs: null,
      year: null,
      quality: null,
      categoryRemoteId: null
    }))
    const start = performance.now()
    upsertVod(db, 1, rows, new Map())
    const elapsed = performance.now() - start
    const count = db.prepare('SELECT COUNT(*) AS n FROM vod WHERE deleted = 0').get() as {
      n: number
    }
    expect(count.n).toBe(50_000)
    // Generous bound — mainly guards against accidental O(n^2) regressions.
    expect(elapsed).toBeLessThan(15_000)
  })
})

describe('upsertEpisodes', () => {
  it('upserts by (series, season, episode) without duplicating', () => {
    const db = openTestDb()
    db.prepare(
      "INSERT INTO series (id, provider_id, series_id, name) VALUES (5, 1, 's1', 'Show')"
    ).run()
    const ep = {
      season: 1,
      episodeNum: 1,
      remoteId: 'e1',
      title: 'Pilot',
      containerExt: 'mp4',
      durationSecs: null,
      plot: null,
      still: null
    }
    upsertEpisodes(db, 5, [ep])
    upsertEpisodes(db, 5, [{ ...ep, title: 'Pilot (remastered)' }])
    const rows = db.prepare('SELECT title FROM episodes').all()
    expect(rows).toEqual([{ title: 'Pilot (remastered)' }])
  })
})

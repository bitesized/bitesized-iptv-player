import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import { insertM3uProvider } from '@main/db/repos/providers'
import { EpgScheduler } from '@main/services/epg/epgScheduler'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

/** Records the URLs passed to ingestXmltv so tests can assert what ran. */
function fakeEpg(): { ingestXmltv: (url: string) => Promise<number>; urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    ingestXmltv: async (url: string) => {
      urls.push(url)
      return 0
    }
  }
}

const HOUR = 60 * 60_000

describe('EpgScheduler', () => {
  it('ingests each provider EPG URL when overdue, then records the run time', async () => {
    const db = openTestDb()
    insertM3uProvider(db, { name: 'A', m3uUrl: '/a.m3u', epgUrl: 'http://x/a.xml' })
    insertM3uProvider(db, { name: 'B', m3uUrl: '/b.m3u', epgUrl: 'http://x/b.xml' })
    const epg = fakeEpg()
    const scheduler = new EpgScheduler(db as never, epg)

    await scheduler.refreshIfDue()
    expect(epg.urls.sort()).toEqual(['http://x/a.xml', 'http://x/b.xml'])

    const saved = db.prepare("SELECT value FROM settings WHERE key = 'epg.lastRefreshAt'").get() as
      { value: string } | undefined
    expect(Number(saved?.value)).toBeGreaterThan(0)
  })

  it('deduplicates a shared EPG URL across providers', async () => {
    const db = openTestDb()
    insertM3uProvider(db, { name: 'A', m3uUrl: '/a.m3u', epgUrl: 'http://x/shared.xml' })
    insertM3uProvider(db, { name: 'B', m3uUrl: '/b.m3u', epgUrl: 'http://x/shared.xml' })
    const epg = fakeEpg()
    await new EpgScheduler(db as never, epg).refreshIfDue()
    expect(epg.urls).toEqual(['http://x/shared.xml'])
  })

  it('skips providers without an EPG URL', async () => {
    const db = openTestDb()
    insertM3uProvider(db, { name: 'A', m3uUrl: '/a.m3u', epgUrl: null })
    const epg = fakeEpg()
    await new EpgScheduler(db as never, epg).refreshIfDue()
    expect(epg.urls).toEqual([])
  })

  it('does not re-ingest within the TTL, but force overrides it', async () => {
    const db = openTestDb()
    insertM3uProvider(db, { name: 'A', m3uUrl: '/a.m3u', epgUrl: 'http://x/a.xml' })
    // A refresh 1 hour ago is still within the 6h TTL.
    db.prepare("INSERT INTO settings (key, value) VALUES ('epg.lastRefreshAt', ?)").run(
      String(Date.now() - HOUR)
    )
    const epg = fakeEpg()
    const scheduler = new EpgScheduler(db as never, epg)

    await scheduler.refreshIfDue()
    expect(epg.urls).toEqual([])

    await scheduler.refreshIfDue(true)
    expect(epg.urls).toEqual(['http://x/a.xml'])
  })

  it('refreshes on resume when the last run is stale', async () => {
    const db = openTestDb()
    insertM3uProvider(db, { name: 'A', m3uUrl: '/a.m3u', epgUrl: 'http://x/a.xml' })
    db.prepare("INSERT INTO settings (key, value) VALUES ('epg.lastRefreshAt', ?)").run(
      String(Date.now() - 7 * HOUR)
    )
    const epg = fakeEpg()

    new EpgScheduler(db as never, epg).onResume()
    // onResume kicks off refreshIfDue asynchronously; let it settle.
    await new Promise((r) => setTimeout(r, 0))
    expect(epg.urls).toEqual(['http://x/a.xml'])
  })

  it('one dead EPG URL does not stop the others', async () => {
    const db = openTestDb()
    insertM3uProvider(db, { name: 'A', m3uUrl: '/a.m3u', epgUrl: 'http://x/bad.xml' })
    insertM3uProvider(db, { name: 'B', m3uUrl: '/b.m3u', epgUrl: 'http://x/good.xml' })
    const seen: string[] = []
    const epg = {
      ingestXmltv: async (url: string) => {
        seen.push(url)
        if (url.includes('bad')) throw new Error('boom')
        return 1
      }
    }
    await new EpgScheduler(db as never, epg).refreshIfDue()
    expect(seen.sort()).toEqual(['http://x/bad.xml', 'http://x/good.xml'])
  })
})

import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import { syncM3uProvider } from '@main/services/m3u/sync'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'm3u', 'PL')").run()
  return db
}

const PLAYLIST = `#EXTM3U url-tvg="http://epg.example/guide.xml"
#EXTINF:-1 tvg-id="one.uk" tvg-logo="http://l/1.png" tvg-chno="1" group-title="General",One HD
http://host/live/1.ts
#EXTINF:-1 group-title="General",Two
http://host/live/2.m3u8
#EXTINF:-1 group-title="Movies | Action",Die Hard (1988)
http://host/vod/900.mkv
`

describe('syncM3uProvider', () => {
  it('imports from a local file, splitting live and vod with categories', async () => {
    const db = openTestDb()
    const dir = mkdtempSync(join(tmpdir(), 'm3u-'))
    const filePath = join(dir, 'playlist.m3u')
    writeFileSync(filePath, PLAYLIST)

    const result = await syncM3uProvider(db, 1, { url: null, filePath }, () => {})
    expect(result.epgUrl).toBe('http://epg.example/guide.xml')

    const channels = db
      .prepare('SELECT name, stream_id, epg_channel_id, num FROM channels ORDER BY id')
      .all() as {
      name: string
      stream_id: string
      epg_channel_id: string | null
      num: number | null
    }[]
    expect(channels).toHaveLength(2)
    expect(channels[0]).toEqual({
      name: 'One HD',
      stream_id: 'http://host/live/1.ts',
      epg_channel_id: 'one.uk',
      num: 1
    })

    const vod = db.prepare('SELECT name, container_ext FROM vod').all()
    expect(vod).toEqual([{ name: 'Die Hard (1988)', container_ext: 'mkv' }])

    const cats = db.prepare('SELECT kind, name FROM categories ORDER BY kind, name').all() as {
      kind: string
      name: string
    }[]
    expect(cats).toEqual([
      { kind: 'live', name: 'General' },
      { kind: 'vod', name: 'Movies | Action' }
    ])

    const provider = db.prepare('SELECT status FROM providers WHERE id = 1').get() as {
      status: string
    }
    expect(provider.status).toBe('ok')
  })

  it('diff-syncs on re-import (removed entries soft-deleted)', async () => {
    const db = openTestDb()
    const dir = mkdtempSync(join(tmpdir(), 'm3u-'))
    const filePath = join(dir, 'playlist.m3u')
    writeFileSync(filePath, PLAYLIST)
    await syncM3uProvider(db, 1, { url: null, filePath }, () => {})

    writeFileSync(
      filePath,
      '#EXTM3U\n#EXTINF:-1 group-title="General",One HD\nhttp://host/live/1.ts\n'
    )
    await syncM3uProvider(db, 1, { url: null, filePath }, () => {})

    const rows = db.prepare('SELECT stream_id, deleted FROM channels ORDER BY id').all() as {
      stream_id: string
      deleted: number
    }[]
    expect(rows).toEqual([
      { stream_id: 'http://host/live/1.ts', deleted: 0 },
      { stream_id: 'http://host/live/2.m3u8', deleted: 1 }
    ])
  })

  it('marks the provider errored when the file is missing', async () => {
    const db = openTestDb()
    await expect(
      syncM3uProvider(db, 1, { url: null, filePath: '/nonexistent/playlist.m3u' }, () => {})
    ).rejects.toThrow()
    const provider = db.prepare('SELECT status FROM providers WHERE id = 1').get() as {
      status: string
    }
    expect(provider.status).toBe('error')
  })
})

import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import { programmesWindow, purgeOldProgrammes, upsertProgrammes } from '@main/db/repos/epg'
import { decodeMaybeBase64 } from '@main/services/epg/epgService'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

describe('epg repo', () => {
  it('upserts programmes idempotently and queries a window', () => {
    const db = openTestDb()
    const rows = [
      { epgChannelId: 'a', start: 100, stop: 200, title: 'P1', description: null, category: null },
      { epgChannelId: 'a', start: 200, stop: 300, title: 'P2', description: null, category: null },
      { epgChannelId: 'b', start: 150, stop: 250, title: 'Q1', description: null, category: null }
    ]
    upsertProgrammes(db, rows)
    upsertProgrammes(db, [{ ...rows[0]!, title: 'P1 updated' }])

    const window = programmesWindow(db, ['a', 'b'], 150, 250)
    expect(window.map((p) => p.title).sort()).toEqual(['P1 updated', 'P2', 'Q1'])

    // Fully outside the window.
    expect(programmesWindow(db, ['a'], 300, 400)).toHaveLength(0)
    expect(programmesWindow(db, [], 0, 1000)).toHaveLength(0)
  })

  it('purges programmes that ended long ago', () => {
    const db = openTestDb()
    const now = Math.floor(Date.now() / 1000)
    upsertProgrammes(db, [
      {
        epgChannelId: 'a',
        start: now - 200_000,
        stop: now - 100_000,
        title: 'Old',
        description: null,
        category: null
      },
      {
        epgChannelId: 'a',
        start: now,
        stop: now + 3600,
        title: 'Current',
        description: null,
        category: null
      }
    ])
    purgeOldProgrammes(db, 86_400)
    const remaining = programmesWindow(db, ['a'], 0, now + 10_000)
    expect(remaining.map((p) => p.title)).toEqual(['Current'])
  })
})

describe('decodeMaybeBase64', () => {
  it('decodes base64 titles', () => {
    expect(decodeMaybeBase64(Buffer.from('Evening News', 'utf8').toString('base64'))).toBe(
      'Evening News'
    )
  })

  it('passes through plain text', () => {
    expect(decodeMaybeBase64('Not base64 at all!')).toBe('Not base64 at all!')
    expect(decodeMaybeBase64(null)).toBeNull()
  })
})

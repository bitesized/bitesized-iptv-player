import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import {
  continueWatching,
  listFavoritesDetailed,
  removeHistory,
  upsertHistory
} from '@main/db/repos/library'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Test')").run()
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Default')").run()
  db.prepare(
    "INSERT INTO vod (id, provider_id, stream_id, name) VALUES (10, 1, 's10', 'A Movie')"
  ).run()
  return db
}

describe('removeHistory', () => {
  it('deletes a watch_history row so it leaves Continue Watching', () => {
    const db = openTestDb()
    upsertHistory(db, {
      profileId: 1,
      itemType: 'vod',
      itemId: 10,
      positionSecs: 60,
      durationSecs: 3600
    })
    expect(continueWatching(db, 1, 10)).toHaveLength(1)

    removeHistory(db, 1, 'vod', 10)
    expect(continueWatching(db, 1, 10)).toHaveLength(0)
  })

  it('is scoped to profile + item and leaves other rows intact', () => {
    const db = openTestDb()
    db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Other')").run()
    upsertHistory(db, {
      profileId: 1,
      itemType: 'vod',
      itemId: 10,
      positionSecs: 60,
      durationSecs: 3600
    })
    upsertHistory(db, {
      profileId: 2,
      itemType: 'vod',
      itemId: 10,
      positionSecs: 60,
      durationSecs: 3600
    })

    removeHistory(db, 1, 'vod', 10)
    expect(continueWatching(db, 1, 10)).toHaveLength(0)
    expect(continueWatching(db, 2, 10)).toHaveLength(1)
  })

  it('is a no-op when there is no matching row', () => {
    const db = openTestDb()
    expect(() => removeHistory(db, 1, 'vod', 999)).not.toThrow()
  })
})

describe('listFavoritesDetailed', () => {
  function seedCatalog(db: Database.Database): void {
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (1, 1, 'live', 'c1', 'Sports')"
    ).run()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (2, 1, 'vod', 'c2', 'Action')"
    ).run()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (3, 1, 'vod', 'c3', 'Adult XXX')"
    ).run()
    db.prepare(
      "INSERT INTO channels (id, provider_id, category_id, stream_id, name, logo) VALUES (20, 1, 1, 's20', 'Sport One', 'http://logo')"
    ).run()
    db.prepare('UPDATE vod SET category_id = 2 WHERE id = 10').run()
    db.prepare(
      "INSERT INTO vod (id, provider_id, category_id, stream_id, name) VALUES (11, 1, 3, 's11', 'Blocked')"
    ).run()
    db.prepare(
      "INSERT INTO vod (id, provider_id, stream_id, name) VALUES (12, 1, 's12', 'Loose Movie')"
    ).run()
  }

  const favorite = (db: Database.Database, type: string, id: number, profileId = 1): void => {
    db.prepare(
      'INSERT INTO favorites (profile_id, item_type, item_id, created_at) VALUES (?, ?, ?, 0)'
    ).run(profileId, type, id)
  }

  it('hydrates favorites with their name and category, uncategorized last', () => {
    const db = openTestDb()
    seedCatalog(db)
    favorite(db, 'live', 20)
    favorite(db, 'vod', 10)
    favorite(db, 'vod', 12)

    const entries = listFavoritesDetailed(db, 1)
    expect(entries.map((e) => [e.itemType, e.name, e.categoryName])).toEqual([
      ['live', 'Sport One', 'Sports'],
      ['vod', 'A Movie', 'Action'],
      ['vod', 'Loose Movie', null]
    ])
    expect(entries[0]!.image).toBe('http://logo')
  })

  it('drops soft-deleted items and scopes to the provider when asked', () => {
    const db = openTestDb()
    seedCatalog(db)
    db.prepare("INSERT INTO providers (id, type, name) VALUES (2, 'xtream', 'Other')").run()
    db.prepare(
      "INSERT INTO vod (id, provider_id, stream_id, name) VALUES (13, 2, 's13', 'Other Provider')"
    ).run()
    favorite(db, 'vod', 10)
    favorite(db, 'vod', 13)
    db.prepare('UPDATE vod SET deleted = 1 WHERE id = 10').run()

    expect(listFavoritesDetailed(db, 1).map((e) => e.name)).toEqual(['Other Provider'])
    expect(listFavoritesDetailed(db, 1, 1)).toEqual([])
  })

  it('hides adult categories from kids profiles', () => {
    const db = openTestDb()
    seedCatalog(db)
    db.prepare("INSERT INTO profiles (id, name, is_kids) VALUES (2, 'Kid', 1)").run()
    favorite(db, 'vod', 10, 2)
    favorite(db, 'vod', 11, 2)

    expect(listFavoritesDetailed(db, 2).map((e) => e.name)).toEqual(['A Movie'])
  })
})

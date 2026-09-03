import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import {
  getChannelsByIds,
  listCategories,
  pageChannels,
  pageVod,
  reorderCategories,
  search,
  setCategoryHidden,
  toFtsQuery
} from '@main/db/repos/browse'
import { toggleFavorite } from '@main/db/repos/library'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Test')").run()
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Default')").run()
  return db
}

function seedChannels(db: Database.Database, count: number): void {
  const insert = db.prepare(
    `INSERT INTO channels (provider_id, category_id, stream_id, name, num, added_at)
     VALUES (1, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    for (let i = 1; i <= count; i++) {
      // Every third channel has no num (tests NULL sort-key paging).
      insert.run(
        null,
        String(i),
        `Channel ${String(i).padStart(4, '0')}`,
        i % 3 === 0 ? null : i,
        i
      )
    }
  })()
}

describe('pageChannels keyset pagination', () => {
  it('walks the whole set in order without duplicates or gaps', () => {
    const db = openTestDb()
    seedChannels(db, 95)

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = pageChannels(db, { cursor, limit: 10, sort: 'num' })
      seen.push(...page.items.map((c) => c.streamId))
      cursor = page.nextCursor
      pages++
      expect(pages).toBeLessThan(30)
    } while (cursor)

    expect(seen).toHaveLength(95)
    expect(new Set(seen).size).toBe(95)

    // Channels with a num come first (ascending), NULL-num channels last.
    const nums = seen.map((id) => Number(id))
    const withNum = nums.filter((n) => n % 3 !== 0)
    expect(withNum).toEqual([...withNum].sort((a, b) => a - b))
    const firstNullIdx = seen.findIndex((id) => Number(id) % 3 === 0)
    expect(seen.slice(firstNullIdx).every((id) => Number(id) % 3 === 0)).toBe(true)
  })

  it('sorts by name with a stable cursor', () => {
    const db = openTestDb()
    seedChannels(db, 25)
    const first = pageChannels(db, { cursor: null, limit: 10, sort: 'name' })
    const second = pageChannels(db, { cursor: first.nextCursor, limit: 10, sort: 'name' })
    const names = [...first.items, ...second.items].map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(new Set(names).size).toBe(20)
  })

  it('filters by favorites virtual category', () => {
    const db = openTestDb()
    seedChannels(db, 10)
    toggleFavorite(db, 1, 'live', 3)
    toggleFavorite(db, 1, 'live', 7)

    const page = pageChannels(db, {
      cursor: null,
      limit: 50,
      categoryId: 'favorites',
      profileId: 1
    })
    expect(page.items.map((c) => c.id).sort()).toEqual([3, 7])
  })

  it('filters uncategorized', () => {
    const db = openTestDb()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (5, 1, 'live', 'r1', 'News')"
    ).run()
    db.prepare(
      "INSERT INTO channels (provider_id, category_id, stream_id, name) VALUES (1, 5, 'a', 'In cat')"
    ).run()
    db.prepare(
      "INSERT INTO channels (provider_id, category_id, stream_id, name) VALUES (1, NULL, 'b', 'No cat')"
    ).run()

    const page = pageChannels(db, { cursor: null, limit: 10, categoryId: 'uncategorized' })
    expect(page.items.map((c) => c.name)).toEqual(['No cat'])
  })

  it('excludes soft-deleted rows', () => {
    const db = openTestDb()
    seedChannels(db, 5)
    db.prepare('UPDATE channels SET deleted = 1 WHERE id = 1').run()
    const page = pageChannels(db, { cursor: null, limit: 10 })
    expect(page.items).toHaveLength(4)
  })
})

describe('pageVod recent sort', () => {
  it('orders by added_at descending for the recent virtual category', () => {
    const db = openTestDb()
    const insert = db.prepare(
      'INSERT INTO vod (provider_id, stream_id, name, added_at) VALUES (1, ?, ?, ?)'
    )
    insert.run('1', 'Old', 100)
    insert.run('2', 'New', 300)
    insert.run('3', 'Mid', 200)

    const page = pageVod(db, { cursor: null, limit: 10, categoryId: 'recent' })
    expect(page.items.map((v) => v.name)).toEqual(['New', 'Mid', 'Old'])
  })
})

describe('listCategories', () => {
  it('returns live item counts excluding deleted items', () => {
    const db = openTestDb()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (5, 1, 'live', 'r1', 'News')"
    ).run()
    db.prepare(
      "INSERT INTO channels (provider_id, category_id, stream_id, name) VALUES (1, 5, 'a', 'A')"
    ).run()
    db.prepare(
      "INSERT INTO channels (provider_id, category_id, stream_id, name, deleted) VALUES (1, 5, 'b', 'B', 1)"
    ).run()

    const cats = listCategories(db, 'live')
    expect(cats).toHaveLength(1)
    expect(cats[0]!.itemCount).toBe(1)
  })

  it('is alphabetical by default with no prefs (hidden=false, position=null)', () => {
    const db = openTestDb()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (1, 1, 'live', 'r1', 'Sports'), (2, 1, 'live', 'r2', 'Anime'), (3, 1, 'live', 'r3', 'Movies')"
    ).run()
    const cats = listCategories(db, 'live', undefined, 1)
    expect(cats.map((c) => c.name)).toEqual(['Anime', 'Movies', 'Sports'])
    expect(cats.every((c) => c.hidden === false && c.position === null)).toBe(true)
  })

  it('reports hidden per profile and honours a manual order (position before name)', () => {
    const db = openTestDb()
    db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Other')").run()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (1, 1, 'live', 'r1', 'Sports'), (2, 1, 'live', 'r2', 'Anime'), (3, 1, 'live', 'r3', 'Movies')"
    ).run()

    // Profile 1: put Sports first, Movies second (Anime keeps NULL → alpha tail).
    reorderCategories(db, 1, [1, 3])
    setCategoryHidden(db, 1, 2, true)

    const p1 = listCategories(db, 'live', undefined, 1)
    expect(p1.map((c) => c.name)).toEqual(['Sports', 'Movies', 'Anime'])
    expect(p1.find((c) => c.name === 'Anime')!.hidden).toBe(true)
    expect(p1.find((c) => c.name === 'Sports')!.position).toBe(0)

    // A different profile is unaffected — still alphabetical, nothing hidden.
    const p2 = listCategories(db, 'live', undefined, 2)
    expect(p2.map((c) => c.name)).toEqual(['Anime', 'Movies', 'Sports'])
    expect(p2.every((c) => c.hidden === false)).toBe(true)

    // Unhiding clears it.
    setCategoryHidden(db, 1, 2, false)
    expect(listCategories(db, 'live', undefined, 1).find((c) => c.name === 'Anime')!.hidden).toBe(
      false
    )
  })
})

describe('search', () => {
  it('builds sanitized prefix FTS queries', () => {
    expect(toFtsQuery('the matr')).toBe('"the"* "matr"*')
    expect(toFtsQuery('  ')).toBeNull()
    expect(toFtsQuery('a"b*c')).toBe('"abc"*')
  })

  it('finds prefix matches ranked and paginates via offset cursor', () => {
    const db = openTestDb()
    const insert = db.prepare('INSERT INTO vod (provider_id, stream_id, name) VALUES (1, ?, ?)')
    insert.run('1', 'The Matrix')
    insert.run('2', 'The Matrix Reloaded')
    insert.run('3', 'Matrimony')
    insert.run('4', 'Unrelated Movie')

    const page = search(db, { term: 'matr', kind: 'vod', cursor: null, limit: 2 })
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBe('2')
    const rest = search(db, { term: 'matr', kind: 'vod', cursor: page.nextCursor, limit: 2 })
    expect(rest.items).toHaveLength(1)
    expect(rest.nextCursor).toBeNull()

    const all = [...page.items, ...rest.items].map((i) => i.name)
    expect(all).toContain('The Matrix')
    expect(all).toContain('Matrimony')
    expect(all).not.toContain('Unrelated Movie')
  })

  it('searches channels and series tables too', () => {
    const db = openTestDb()
    db.prepare(
      "INSERT INTO channels (provider_id, stream_id, name) VALUES (1, 'c1', 'Sky Sports News')"
    ).run()
    db.prepare(
      "INSERT INTO series (provider_id, series_id, name) VALUES (1, 's1', 'Sports Documentary')"
    ).run()

    expect(search(db, { term: 'sport', kind: 'live', cursor: null, limit: 10 }).items).toHaveLength(
      1
    )
    expect(
      search(db, { term: 'sport', kind: 'series', cursor: null, limit: 10 }).items
    ).toHaveLength(1)
  })

  it('filters movies by year and quality alongside the FTS term', () => {
    const db = openTestDb()
    const insert = db.prepare(
      'INSERT INTO vod (provider_id, stream_id, name, year, quality) VALUES (1, ?, ?, ?, ?)'
    )
    insert.run('1', 'Dune', 2021, '4K')
    insert.run('2', 'Dune', 1984, 'SD')
    insert.run('3', 'Dune Part Two', 2024, '1080p')

    const byYear = search(db, { term: 'dune', kind: 'vod', cursor: null, limit: 10, year: 2021 })
    expect(byYear.items.map((i) => i.name)).toEqual(['Dune'])

    const byQuality = search(db, {
      term: 'dune',
      kind: 'vod',
      cursor: null,
      limit: 10,
      quality: '4K'
    })
    expect(byQuality.items).toHaveLength(1)
    expect((byQuality.items[0] as { year?: number | null }).year).toBe(2021)

    // No filter → all three matches.
    expect(search(db, { term: 'dune', kind: 'vod', cursor: null, limit: 10 }).items).toHaveLength(3)
  })

  it('filters series by genre substring alongside the FTS term', () => {
    const db = openTestDb()
    const insert = db.prepare(
      'INSERT INTO series (provider_id, series_id, name, genre) VALUES (1, ?, ?, ?)'
    )
    insert.run('1', 'Space Cops', 'Sci-Fi, Action')
    insert.run('2', 'Space Kitchen', 'Comedy')

    const scifi = search(db, {
      term: 'space',
      kind: 'series',
      cursor: null,
      limit: 10,
      genre: 'Sci-Fi'
    })
    expect(scifi.items.map((i) => i.name)).toEqual(['Space Cops'])
  })
})

describe('getChannelsByIds', () => {
  it('returns the requested channels in the order asked for, skipping misses', () => {
    const db = openTestDb()
    seedChannels(db, 5)
    const ids = pageChannels(db, { limit: 3, cursor: null }).items.map((c) => c.id)
    const requested = [ids[2]!, 99_999, ids[0]!]
    expect(getChannelsByIds(db, requested).map((c) => c.id)).toEqual([ids[2], ids[0]])
    expect(getChannelsByIds(db, [])).toEqual([])
  })
})

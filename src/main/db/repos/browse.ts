// Read-side queries for the browse UI. Everything is keyset-paginated: the
// renderer only ever receives windows of rows, and cursors stay O(1) however
// deep the scroll goes.

import type { AppDatabase } from '@main/db'
import type { BrowseQuery, SearchQuery } from '@shared/contracts'
import { isKidsProfile } from './profiles'
import type { Category, Channel, ContentKind, Episode, Page, Series, VodItem } from '@shared/types'

/**
 * Categories hidden from kids profiles (name heuristic — providers flag adult
 * content in category names). A per-profile category lock list can extend
 * this later.
 */
export const ADULT_CATEGORY_SQL = `SELECT id FROM categories
   WHERE lower(name) LIKE '%adult%' OR lower(name) LIKE '%xxx%'
      OR lower(name) LIKE '%porn%' OR name LIKE '%18+%'`

// --- Cursor encoding ------------------------------------------------------

interface Cursor {
  v: string | number | null
  id: number
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    if (typeof parsed.id !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

// --- Categories -----------------------------------------------------------

const COUNT_TABLE: Record<ContentKind, string> = {
  live: 'channels',
  vod: 'vod',
  series: 'series'
}

export function listCategories(
  db: AppDatabase,
  kind: ContentKind,
  providerId?: number,
  profileId?: number
): Category[] {
  const table = COUNT_TABLE[kind]
  const kidsFilter = isKidsProfile(db, profileId) ? `AND c.id NOT IN (${ADULT_CATEGORY_SQL})` : ''
  // Join per-profile prefs (hidden/position). No profile → no prefs match
  // (-1 is never a real profile id), so everything defaults to visible/alpha.
  const prefsProfile = profileId ?? -1
  const rows = db
    .prepare(
      `SELECT c.id, c.provider_id, c.kind, c.remote_id, c.name,
              (SELECT COUNT(*) FROM ${table} t
               WHERE t.category_id = c.id AND t.deleted = 0) AS item_count,
              COALESCE(cp.hidden, 0) AS hidden,
              cp.position AS position
       FROM categories c
       LEFT JOIN category_prefs cp
              ON cp.category_id = c.id AND cp.profile_id = ?
       WHERE c.kind = ? AND c.deleted = 0
         ${providerId ? 'AND c.provider_id = ?' : ''}
         ${kidsFilter}
       ORDER BY (cp.position IS NULL), cp.position, c.name COLLATE NOCASE`
    )
    .all(...(providerId ? [prefsProfile, kind, providerId] : [prefsProfile, kind])) as {
    id: number
    provider_id: number
    kind: ContentKind
    remote_id: string
    name: string
    item_count: number
    hidden: number
    position: number | null
  }[]

  return rows.map((r) => ({
    id: r.id,
    providerId: r.provider_id,
    kind: r.kind,
    remoteId: r.remote_id,
    name: r.name,
    itemCount: r.item_count,
    hidden: r.hidden !== 0,
    position: r.position
  }))
}

/** Hide or unhide a category for one profile (upserts the pref row). */
export function setCategoryHidden(
  db: AppDatabase,
  profileId: number,
  categoryId: number,
  hidden: boolean
): void {
  db.prepare(
    `INSERT INTO category_prefs (profile_id, category_id, hidden)
     VALUES (?, ?, ?)
     ON CONFLICT(profile_id, category_id) DO UPDATE SET hidden = excluded.hidden`
  ).run(profileId, categoryId, hidden ? 1 : 0)
}

/**
 * Persist a manual category order for one profile: each id gets its index as
 * `position`. Categories omitted from `orderedIds` keep their existing pref
 * (and thus fall to the alphabetical tail). Runs in a single transaction.
 */
export function reorderCategories(db: AppDatabase, profileId: number, orderedIds: number[]): void {
  const upsert = db.prepare(
    `INSERT INTO category_prefs (profile_id, category_id, position)
     VALUES (?, ?, ?)
     ON CONFLICT(profile_id, category_id) DO UPDATE SET position = excluded.position`
  )
  const run = db.transaction((ids: number[]) => {
    ids.forEach((categoryId, index) => upsert.run(profileId, categoryId, index))
  })
  run(orderedIds)
}

// --- Generic keyset pager -------------------------------------------------

interface SortSpec {
  /** SQL expression to sort by (table-qualified). */
  expr: string
  /** Direction of the sort key. */
  desc: boolean
  /** Extract the sort value from a fetched row for the next cursor. */
  value: (row: Record<string, unknown>) => string | number | null
}

interface PageSpec {
  table: 'channels' | 'vod' | 'series'
  favoriteType: ContentKind
  sort: SortSpec
  query: BrowseQuery
}

function pageRows(db: AppDatabase, spec: PageSpec): Page<Record<string, unknown>> {
  const { table, sort, query } = spec
  const limit = Math.min(Math.max(query.limit, 1), 500)
  const where: string[] = ['t.deleted = 0']
  const args: unknown[] = []

  if (query.providerId !== undefined) {
    where.push('t.provider_id = ?')
    args.push(query.providerId)
  }

  if (isKidsProfile(db, query.profileId)) {
    where.push(`(t.category_id IS NULL OR t.category_id NOT IN (${ADULT_CATEGORY_SQL}))`)
  }

  const categoryId = query.categoryId ?? 'all'
  if (typeof categoryId === 'number') {
    where.push('t.category_id = ?')
    args.push(categoryId)
  } else if (categoryId === 'uncategorized') {
    where.push('t.category_id IS NULL')
  } else if (categoryId === 'favorites') {
    where.push(
      'EXISTS (SELECT 1 FROM favorites f WHERE f.profile_id = ? AND f.item_type = ? AND f.item_id = t.id)'
    )
    args.push(query.profileId ?? 0, spec.favoriteType)
  }
  // 'all' and 'recent' need no filter; 'recent' is a sort concern.

  // Rows with a NULL sort key always sort last (NULLS LAST below), so the
  // cursor predicate must admit the NULL tail until we're inside it.
  const cursor = decodeCursor(query.cursor)
  const dir = sort.desc ? '<' : '>'
  if (cursor) {
    if (cursor.v === null) {
      // Inside the NULL tail — page by id alone.
      where.push(`((${sort.expr}) IS NULL AND t.id > ?)`)
      args.push(cursor.id)
    } else {
      where.push(
        `((${sort.expr}) ${dir} ? OR (${sort.expr}) IS NULL OR ((${sort.expr}) = ? AND t.id > ?))`
      )
      args.push(cursor.v, cursor.v, cursor.id)
    }
  }

  const orderBy = `(${sort.expr}) ${sort.desc ? 'DESC' : 'ASC'} NULLS LAST, t.id ASC`

  const rows = db
    .prepare(
      `SELECT t.* FROM ${table} t
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ?`
    )
    .all(...args, limit + 1) as Record<string, unknown>[]

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      hasMore && last ? encodeCursor({ v: sort.value(last), id: last['id'] as number }) : null
  }
}

// --- Row mappers ----------------------------------------------------------

function toChannel(r: Record<string, unknown>): Channel {
  return {
    id: r['id'] as number,
    providerId: r['provider_id'] as number,
    categoryId: r['category_id'] as number | null,
    streamId: r['stream_id'] as string,
    name: r['name'] as string,
    logo: r['logo'] as string | null,
    streamType: r['stream_type'] as string | null,
    tvArchive: (r['tv_archive'] as number) !== 0,
    epgChannelId: r['epg_channel_id'] as string | null,
    num: r['num'] as number | null,
    addedAt: r['added_at'] as number | null
  }
}

function toVod(r: Record<string, unknown>): VodItem {
  return {
    id: r['id'] as number,
    providerId: r['provider_id'] as number,
    categoryId: r['category_id'] as number | null,
    streamId: r['stream_id'] as string,
    name: r['name'] as string,
    cover: r['cover'] as string | null,
    rating: r['rating'] as number | null,
    addedAt: r['added_at'] as number | null,
    containerExt: r['container_ext'] as string | null,
    tmdbId: r['tmdb_id'] as string | null,
    plot: r['plot'] as string | null,
    durationSecs: r['duration_secs'] as number | null,
    year: (r['year'] as number | null) ?? null,
    quality: (r['quality'] as string | null) ?? null
  }
}

function toSeries(r: Record<string, unknown>): Series {
  return {
    id: r['id'] as number,
    providerId: r['provider_id'] as number,
    categoryId: r['category_id'] as number | null,
    seriesId: r['series_id'] as string,
    name: r['name'] as string,
    cover: r['cover'] as string | null,
    plot: r['plot'] as string | null,
    rating: r['rating'] as number | null,
    genre: r['genre'] as string | null,
    releaseDate: r['release_date'] as string | null,
    addedAt: (r['added_at'] as number | null) ?? null
  }
}

// --- Sort specs -----------------------------------------------------------

function sortSpec(
  query: BrowseQuery,
  defaultSort: 'name' | 'added' | 'num',
  allowed: readonly ('name' | 'added' | 'num')[]
): SortSpec {
  let sort = query.categoryId === 'recent' ? 'added' : (query.sort ?? defaultSort)
  // Only channels have a `num` column — clamp sorts the table can't serve
  // instead of letting the query throw.
  if (!allowed.includes(sort)) sort = defaultSort
  switch (sort) {
    case 'name':
      return {
        expr: 't.name COLLATE NOCASE',
        desc: false,
        value: (r) => (r['name'] as string).toLowerCase()
      }
    case 'added':
      return { expr: 't.added_at', desc: true, value: (r) => r['added_at'] as number | null }
    case 'num':
      return { expr: 't.num', desc: false, value: (r) => r['num'] as number | null }
  }
}

// --- Public pagers --------------------------------------------------------

export function pageChannels(db: AppDatabase, query: BrowseQuery): Page<Channel> {
  const page = pageRows(db, {
    table: 'channels',
    favoriteType: 'live',
    sort: sortSpec(query, 'num', ['name', 'added', 'num']),
    query
  })
  return { items: page.items.map(toChannel), nextCursor: page.nextCursor }
}

export function pageVod(db: AppDatabase, query: BrowseQuery): Page<VodItem> {
  const page = pageRows(db, {
    table: 'vod',
    favoriteType: 'vod',
    sort: sortSpec(query, 'name', ['name', 'added']),
    query
  })
  return { items: page.items.map(toVod), nextCursor: page.nextCursor }
}

export function pageSeries(db: AppDatabase, query: BrowseQuery): Page<Series> {
  const page = pageRows(db, {
    table: 'series',
    favoriteType: 'series',
    sort: sortSpec(query, 'name', ['name', 'added']),
    query
  })
  return { items: page.items.map(toSeries), nextCursor: page.nextCursor }
}

/**
 * Prev/next channel for zapping, in the Live list's default order:
 * channels with a number first (ascending), then number-less ones by id —
 * scoped to the channel's provider.
 */
export function adjacentChannels(
  db: AppDatabase,
  channelId: number
): { prevId: number | null; nextId: number | null } {
  const current = db
    .prepare('SELECT provider_id, num, id FROM channels WHERE id = ?')
    .get(channelId) as { provider_id: number; num: number | null; id: number } | undefined
  if (!current) return { prevId: null, nextId: null }

  // Sort key as a comparable tuple: (num IS NULL, num-or-0, id).
  const key = [current.num === null ? 1 : 0, current.num ?? 0, current.id]
  const next = db
    .prepare(
      `SELECT id FROM channels
       WHERE provider_id = ? AND deleted = 0
         AND (num IS NULL, COALESCE(num, 0), id) > (?, ?, ?)
       ORDER BY (num IS NULL), COALESCE(num, 0), id
       LIMIT 1`
    )
    .get(current.provider_id, ...key) as { id: number } | undefined
  const prev = db
    .prepare(
      `SELECT id FROM channels
       WHERE provider_id = ? AND deleted = 0
         AND (num IS NULL, COALESCE(num, 0), id) < (?, ?, ?)
       ORDER BY (num IS NULL) DESC, COALESCE(num, 0) DESC, id DESC
       LIMIT 1`
    )
    .get(current.provider_id, ...key) as { id: number } | undefined

  return { prevId: prev?.id ?? null, nextId: next?.id ?? null }
}

// --- By-id lookups --------------------------------------------------------

export function getChannelById(db: AppDatabase, id: number): Channel | null {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
  return row ? toChannel(row) : null
}

/**
 * Batched by-id lookup, in the order the ids were given. `epg:nowNext` asks for
 * a whole screenful of channels at once; one statement beats compiling and
 * running a by-id query per channel (better-sqlite3 does not cache prepares).
 */
export function getChannelsByIds(db: AppDatabase, ids: number[]): Channel[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(`SELECT * FROM channels WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Record<string, unknown>[]
  const byId = new Map(rows.map((r) => [r['id'] as number, toChannel(r)]))
  return ids.map((id) => byId.get(id)).filter((c): c is Channel => c !== undefined)
}

export function getVodById(db: AppDatabase, id: number): VodItem | null {
  const row = db.prepare('SELECT * FROM vod WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
  return row ? toVod(row) : null
}

export function getSeriesById(db: AppDatabase, id: number): Series | null {
  const row = db.prepare('SELECT * FROM series WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
  return row ? toSeries(row) : null
}

export function listEpisodes(db: AppDatabase, seriesId: number): Episode[] {
  const rows = db
    .prepare('SELECT * FROM episodes WHERE series_id = ? ORDER BY season, episode_num')
    .all(seriesId) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r['id'] as number,
    seriesId: r['series_id'] as number,
    season: r['season'] as number,
    episodeNum: r['episode_num'] as number,
    remoteId: r['remote_id'] as string,
    title: r['title'] as string | null,
    containerExt: r['container_ext'] as string | null,
    durationSecs: r['duration_secs'] as number | null,
    plot: r['plot'] as string | null,
    still: r['still'] as string | null
  }))
}

export function getEpisodeById(
  db: AppDatabase,
  id: number
): (Episode & { providerId: number }) | null {
  const row = db
    .prepare(
      `SELECT e.*, s.provider_id FROM episodes e
       JOIN series s ON s.id = e.series_id
       WHERE e.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row['id'] as number,
    seriesId: row['series_id'] as number,
    season: row['season'] as number,
    episodeNum: row['episode_num'] as number,
    remoteId: row['remote_id'] as string,
    title: row['title'] as string | null,
    containerExt: row['container_ext'] as string | null,
    durationSecs: row['duration_secs'] as number | null,
    plot: row['plot'] as string | null,
    still: row['still'] as string | null,
    providerId: row['provider_id'] as number
  }
}

// --- Search ---------------------------------------------------------------

const FTS_TABLE: Record<ContentKind, { fts: string; base: string }> = {
  live: { fts: 'channels_fts', base: 'channels' },
  vod: { fts: 'vod_fts', base: 'vod' },
  series: { fts: 'series_fts', base: 'series' }
}

/** Build a prefix-matching FTS query from user input, quoting each token. */
export function toFtsQuery(term: string): string | null {
  const tokens = term
    .split(/\s+/)
    .map((t) => t.replace(/["*^]/g, '').trim())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return null
  return tokens.map((t) => `"${t}"*`).join(' ')
}

/**
 * Ranked FTS search. Search paging uses rank-ordered OFFSET cursors — users
 * rarely page deep into search results, and bm25 rank has no stable keyset.
 */
export function search(db: AppDatabase, query: SearchQuery): Page<Channel | VodItem | Series> {
  const ftsQuery = toFtsQuery(query.term)
  if (!ftsQuery) return { items: [], nextCursor: null }

  const { fts, base } = FTS_TABLE[query.kind]
  const limit = Math.min(Math.max(query.limit, 1), 200)
  const offset = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0

  const providerFilter = query.providerId !== undefined ? 'AND t.provider_id = ?' : ''
  const kidsFilter = isKidsProfile(db, query.profileId)
    ? `AND (t.category_id IS NULL OR t.category_id NOT IN (${ADULT_CATEGORY_SQL}))`
    : ''
  const args: unknown[] = [ftsQuery]
  if (query.providerId !== undefined) args.push(query.providerId)

  // Optional filters combinable with the FTS term. Only applied for
  // the kind that carries the column, so an irrelevant filter is a no-op.
  const filters: string[] = []
  if (query.kind === 'vod' && query.year !== undefined) {
    filters.push('AND t.year = ?')
    args.push(query.year)
  }
  if (query.kind === 'vod' && query.quality) {
    filters.push('AND t.quality = ?')
    args.push(query.quality)
  }
  if (query.kind === 'series' && query.genre) {
    filters.push('AND t.genre LIKE ?')
    args.push(`%${query.genre}%`)
  }
  const filterSql = filters.join(' ')

  const rows = db
    .prepare(
      `SELECT t.* FROM ${fts} f
       JOIN ${base} t ON t.id = f.rowid
       WHERE ${fts} MATCH ? AND t.deleted = 0 ${providerFilter} ${kidsFilter} ${filterSql}
       ORDER BY bm25(${fts}), t.name COLLATE NOCASE
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit + 1, offset) as Record<string, unknown>[]

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const mapper: (r: Record<string, unknown>) => Channel | VodItem | Series =
    query.kind === 'live' ? toChannel : query.kind === 'vod' ? toVod : toSeries
  return {
    items: items.map(mapper),
    nextCursor: hasMore ? String(offset + limit) : null
  }
}

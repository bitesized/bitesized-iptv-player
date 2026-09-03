// Per-profile favorites and watch history.

import type { AppDatabase } from '@main/db'
import type { ContentKind, ContinueWatchingItem, FavoriteEntry } from '@shared/types'
import { ADULT_CATEGORY_SQL } from './browse'
import { isKidsProfile } from './profiles'

export function toggleFavorite(
  db: AppDatabase,
  profileId: number,
  itemType: ContentKind,
  itemId: number
): boolean {
  const removed = db
    .prepare('DELETE FROM favorites WHERE profile_id = ? AND item_type = ? AND item_id = ?')
    .run(profileId, itemType, itemId)
  if (removed.changes > 0) return false
  db.prepare(
    'INSERT INTO favorites (profile_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(profileId, itemType, itemId, Math.floor(Date.now() / 1000))
  return true
}

export function removeHistory(
  db: AppDatabase,
  profileId: number,
  itemType: 'vod' | 'episode' | 'live',
  itemId: number
): void {
  db.prepare(
    'DELETE FROM watch_history WHERE profile_id = ? AND item_type = ? AND item_id = ?'
  ).run(profileId, itemType, itemId)
}

export function listFavorites(
  db: AppDatabase,
  profileId: number,
  itemType?: ContentKind
): { itemType: ContentKind; itemId: number }[] {
  const rows = (
    itemType
      ? db
          .prepare(
            'SELECT item_type, item_id FROM favorites WHERE profile_id = ? AND item_type = ? ORDER BY created_at DESC'
          )
          .all(profileId, itemType)
      : db
          .prepare(
            'SELECT item_type, item_id FROM favorites WHERE profile_id = ? ORDER BY created_at DESC'
          )
          .all(profileId)
  ) as { item_type: ContentKind; item_id: number }[]
  return rows.map((r) => ({ itemType: r.item_type, itemId: r.item_id }))
}

/** Per-kind source table for the hydrated favorites query. */
const FAVORITE_SOURCES: { itemType: ContentKind; table: string; image: string }[] = [
  { itemType: 'live', table: 'channels', image: 'logo' },
  { itemType: 'vod', table: 'vod', image: 'cover' },
  { itemType: 'series', table: 'series', image: 'cover' }
]

/**
 * Favorites joined to their item and category, for the grouped favorites view.
 * Soft-deleted items drop out, and kids profiles never see adult categories —
 * the same rules the browse pagers apply.
 */
export function listFavoritesDetailed(
  db: AppDatabase,
  profileId: number,
  providerId?: number
): FavoriteEntry[] {
  const kids = isKidsProfile(db, profileId)
  const args: unknown[] = []
  const branches = FAVORITE_SOURCES.map(({ itemType, table, image }) => {
    args.push(profileId)
    if (providerId !== undefined) args.push(providerId)
    return `SELECT '${itemType}' AS item_type, t.id AS item_id, t.provider_id AS provider_id,
                   t.name AS name, t.${image} AS image, t.category_id AS category_id,
                   c.name AS category_name, f.created_at AS created_at
            FROM favorites f
            JOIN ${table} t ON t.id = f.item_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE f.profile_id = ? AND f.item_type = '${itemType}' AND t.deleted = 0
              ${providerId !== undefined ? 'AND t.provider_id = ?' : ''}
              ${kids ? `AND (t.category_id IS NULL OR t.category_id NOT IN (${ADULT_CATEGORY_SQL}))` : ''}`
  })

  const rows = db
    .prepare(
      // The union is wrapped in a subquery because SQLite only accepts bare
      // result columns in a compound SELECT's ORDER BY. Uncategorized favorites
      // sort to the tail of each type, matching the sidebar's NULLS-LAST order.
      `SELECT * FROM (${branches.join(' UNION ALL ')})
       ORDER BY CASE item_type WHEN 'live' THEN 0 WHEN 'vod' THEN 1 ELSE 2 END,
                (category_name IS NULL), category_name COLLATE NOCASE,
                name COLLATE NOCASE`
    )
    .all(...args) as {
    item_type: ContentKind
    item_id: number
    provider_id: number
    name: string
    image: string | null
    category_id: number | null
    category_name: string | null
    created_at: number
  }[]

  return rows.map((r) => ({
    itemType: r.item_type,
    itemId: r.item_id,
    providerId: r.provider_id,
    name: r.name,
    image: r.image,
    categoryId: r.category_id,
    categoryName: r.category_name,
    createdAt: r.created_at
  }))
}

export function upsertHistory(
  db: AppDatabase,
  input: {
    profileId: number
    itemType: 'vod' | 'episode' | 'live'
    itemId: number
    positionSecs: number
    durationSecs: number | null
  }
): void {
  // >95% watched counts as completed (standard continue-watching heuristic).
  const completed =
    input.durationSecs !== null && input.durationSecs > 0
      ? input.positionSecs / input.durationSecs > 0.95
        ? 1
        : 0
      : 0
  db.prepare(
    `INSERT INTO watch_history (profile_id, item_type, item_id, position_secs, duration_secs, updated_at, completed)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, item_type, item_id) DO UPDATE SET
       position_secs = excluded.position_secs,
       duration_secs = excluded.duration_secs,
       updated_at = excluded.updated_at,
       completed = excluded.completed`
  ).run(
    input.profileId,
    input.itemType,
    input.itemId,
    input.positionSecs,
    input.durationSecs,
    Math.floor(Date.now() / 1000),
    completed
  )
}

export function continueWatching(
  db: AppDatabase,
  profileId: number,
  limit: number
): ContinueWatchingItem[] {
  const rows = db
    .prepare(
      `SELECT h.item_type, h.item_id, h.position_secs, h.duration_secs, h.updated_at,
              v.name AS vod_name, v.cover AS vod_cover,
              e.title AS ep_title, e.season, e.episode_num, e.still AS ep_still,
              s.id AS series_id, s.name AS series_name, s.cover AS series_cover
       FROM watch_history h
       LEFT JOIN vod v ON h.item_type = 'vod' AND v.id = h.item_id
       LEFT JOIN episodes e ON h.item_type = 'episode' AND e.id = h.item_id
       LEFT JOIN series s ON s.id = e.series_id
       WHERE h.profile_id = ? AND h.completed = 0 AND h.item_type != 'live'
       ORDER BY h.updated_at DESC LIMIT ?`
    )
    .all(profileId, Math.min(limit, 100)) as {
    item_type: 'vod' | 'episode'
    item_id: number
    position_secs: number
    duration_secs: number | null
    updated_at: number
    vod_name: string | null
    vod_cover: string | null
    ep_title: string | null
    season: number | null
    episode_num: number | null
    ep_still: string | null
    series_id: number | null
    series_name: string | null
    series_cover: string | null
  }[]

  return rows
    .filter((r) => r.vod_name !== null || r.series_id !== null)
    .map((r) => {
      if (r.item_type === 'vod') {
        return {
          itemType: 'vod' as const,
          itemId: r.item_id,
          name: r.vod_name ?? 'Unknown',
          cover: r.vod_cover,
          positionSecs: r.position_secs,
          durationSecs: r.duration_secs,
          updatedAt: r.updated_at
        }
      }
      return {
        itemType: 'episode' as const,
        itemId: r.item_id,
        name: r.ep_title ?? `Episode ${r.episode_num ?? '?'}`,
        cover: r.ep_still ?? r.series_cover,
        positionSecs: r.position_secs,
        durationSecs: r.duration_secs,
        updatedAt: r.updated_at,
        seriesId: r.series_id ?? undefined,
        seriesName: r.series_name ?? undefined,
        season: r.season ?? undefined,
        episodeNum: r.episode_num ?? undefined
      }
    })
}

export function getResumePosition(
  db: AppDatabase,
  profileId: number,
  itemType: 'vod' | 'episode',
  itemId: number
): number | null {
  const row = db
    .prepare(
      'SELECT position_secs, completed FROM watch_history WHERE profile_id = ? AND item_type = ? AND item_id = ?'
    )
    .get(profileId, itemType, itemId) as { position_secs: number; completed: number } | undefined
  if (!row || row.completed !== 0) return null
  return row.position_secs
}

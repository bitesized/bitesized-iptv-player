// Batched catalog writes used by provider sync. All upserts run in
// transactions of BATCH_SIZE rows so a 100k-item import stays fast without
// holding one giant transaction.

import type { AppDatabase } from '@main/db'
import type { ContentKind } from '@shared/types'
import type {
  CategoryRow,
  ChannelRow,
  EpisodeRow,
  SeriesRow,
  VodRow
} from '@main/services/xtream/normalize'

export const BATCH_SIZE = 2000

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * Upsert categories for one provider+kind and return remoteId → local id.
 * Categories missing from `rows` are soft-deleted.
 */
export function upsertCategories(
  db: AppDatabase,
  providerId: number,
  kind: ContentKind,
  rows: CategoryRow[]
): Map<string, number> {
  const upsert = db.prepare(
    `INSERT INTO categories (provider_id, kind, remote_id, name, deleted)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (provider_id, kind, remote_id)
     DO UPDATE SET name = excluded.name, deleted = 0`
  )
  db.transaction(() => {
    for (const row of rows) upsert.run(providerId, kind, row.remoteId, row.name)
  })()
  softDeleteMissing(
    db,
    'categories',
    'remote_id',
    rows.map((r) => r.remoteId),
    'provider_id = ? AND kind = ?',
    [providerId, kind]
  )

  const map = new Map<string, number>()
  const stored = db
    .prepare('SELECT id, remote_id FROM categories WHERE provider_id = ? AND kind = ?')
    .all(providerId, kind) as { id: number; remote_id: string }[]
  for (const row of stored) map.set(row.remote_id, row.id)
  return map
}

export function upsertChannels(
  db: AppDatabase,
  providerId: number,
  rows: ChannelRow[],
  categoryIds: Map<string, number>,
  onBatch?: (processed: number) => void
): void {
  const upsert = db.prepare(
    `INSERT INTO channels
       (provider_id, category_id, stream_id, name, logo, stream_type, tv_archive,
        epg_channel_id, num, added_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (provider_id, stream_id) DO UPDATE SET
       category_id = excluded.category_id, name = excluded.name, logo = excluded.logo,
       stream_type = excluded.stream_type, tv_archive = excluded.tv_archive,
       epg_channel_id = excluded.epg_channel_id, num = excluded.num,
       added_at = excluded.added_at, deleted = 0`
  )
  let processed = 0
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction(() => {
      for (const row of batch) {
        upsert.run(
          providerId,
          row.categoryRemoteId !== null ? (categoryIds.get(row.categoryRemoteId) ?? null) : null,
          row.streamId,
          row.name,
          row.logo,
          row.streamType,
          row.tvArchive,
          row.epgChannelId,
          row.num,
          row.addedAt
        )
      }
    })()
    processed += batch.length
    onBatch?.(processed)
  }
  softDeleteMissing(
    db,
    'channels',
    'stream_id',
    rows.map((r) => r.streamId),
    'provider_id = ?',
    [providerId]
  )
}

export function upsertVod(
  db: AppDatabase,
  providerId: number,
  rows: VodRow[],
  categoryIds: Map<string, number>,
  onBatch?: (processed: number) => void
): void {
  const upsert = db.prepare(
    `INSERT INTO vod
       (provider_id, category_id, stream_id, name, cover, rating, added_at,
        container_ext, tmdb_id, plot, duration_secs, year, quality, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (provider_id, stream_id) DO UPDATE SET
       category_id = excluded.category_id, name = excluded.name, cover = excluded.cover,
       rating = excluded.rating, added_at = excluded.added_at,
       container_ext = excluded.container_ext, tmdb_id = excluded.tmdb_id,
       plot = excluded.plot, duration_secs = excluded.duration_secs,
       year = excluded.year, quality = excluded.quality, deleted = 0`
  )
  let processed = 0
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction(() => {
      for (const row of batch) {
        upsert.run(
          providerId,
          row.categoryRemoteId !== null ? (categoryIds.get(row.categoryRemoteId) ?? null) : null,
          row.streamId,
          row.name,
          row.cover,
          row.rating,
          row.addedAt,
          row.containerExt,
          row.tmdbId,
          row.plot,
          row.durationSecs,
          row.year,
          row.quality
        )
      }
    })()
    processed += batch.length
    onBatch?.(processed)
  }
  softDeleteMissing(
    db,
    'vod',
    'stream_id',
    rows.map((r) => r.streamId),
    'provider_id = ?',
    [providerId]
  )
}

export function upsertSeries(
  db: AppDatabase,
  providerId: number,
  rows: SeriesRow[],
  categoryIds: Map<string, number>,
  onBatch?: (processed: number) => void
): void {
  const upsert = db.prepare(
    `INSERT INTO series
       (provider_id, category_id, series_id, name, cover, plot, rating, genre,
        release_date, added_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (provider_id, series_id) DO UPDATE SET
       category_id = excluded.category_id, name = excluded.name, cover = excluded.cover,
       plot = excluded.plot, rating = excluded.rating, genre = excluded.genre,
       release_date = excluded.release_date, added_at = excluded.added_at, deleted = 0`
  )
  let processed = 0
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction(() => {
      for (const row of batch) {
        upsert.run(
          providerId,
          row.categoryRemoteId !== null ? (categoryIds.get(row.categoryRemoteId) ?? null) : null,
          row.seriesId,
          row.name,
          row.cover,
          row.plot,
          row.rating,
          row.genre,
          row.releaseDate,
          row.addedAt
        )
      }
    })()
    processed += batch.length
    onBatch?.(processed)
  }
  softDeleteMissing(
    db,
    'series',
    'series_id',
    rows.map((r) => r.seriesId),
    'provider_id = ?',
    [providerId]
  )
}

export function upsertEpisodes(db: AppDatabase, seriesId: number, rows: EpisodeRow[]): void {
  const upsert = db.prepare(
    `INSERT INTO episodes
       (series_id, season, episode_num, remote_id, title, container_ext,
        duration_secs, plot, still)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (series_id, season, episode_num) DO UPDATE SET
       remote_id = excluded.remote_id, title = excluded.title,
       container_ext = excluded.container_ext, duration_secs = excluded.duration_secs,
       plot = excluded.plot, still = excluded.still`
  )
  db.transaction(() => {
    for (const row of rows) {
      upsert.run(
        seriesId,
        row.season,
        row.episodeNum,
        row.remoteId,
        row.title,
        row.containerExt,
        row.durationSecs,
        row.plot,
        row.still
      )
    }
  })()
}

/**
 * Soft-delete rows of `table` (scoped by `where`) whose `keyColumn` is not in
 * `presentKeys`. Uses a temp table so 100k keys don't hit SQLite's variable
 * limit.
 */
function softDeleteMissing(
  db: AppDatabase,
  table: 'categories' | 'channels' | 'vod' | 'series',
  keyColumn: string,
  presentKeys: string[],
  where: string,
  whereArgs: unknown[]
): void {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS present_keys (k TEXT PRIMARY KEY)')
  db.exec('DELETE FROM present_keys')
  const insert = db.prepare('INSERT OR IGNORE INTO present_keys (k) VALUES (?)')
  for (const batch of chunk(presentKeys, BATCH_SIZE)) {
    db.transaction(() => {
      for (const key of batch) insert.run(key)
    })()
  }
  db.prepare(
    `UPDATE ${table} SET deleted = 1
     WHERE ${where} AND deleted = 0
       AND ${keyColumn} NOT IN (SELECT k FROM present_keys)`
  ).run(...whereArgs)
  db.exec('DELETE FROM present_keys')
}

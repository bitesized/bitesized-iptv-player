import type { AppDatabase } from '@main/db'
import type { EpgProgramme } from '@shared/types'
import { chunk } from './catalog'

export interface ProgrammeRow {
  epgChannelId: string
  start: number
  stop: number
  title: string
  description: string | null
  category: string | null
}

export function upsertProgrammes(db: AppDatabase, rows: ProgrammeRow[]): void {
  const upsert = db.prepare(
    `INSERT INTO epg_programmes (epg_channel_id, start, stop, title, description, category)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (epg_channel_id, start) DO UPDATE SET
       stop = excluded.stop, title = excluded.title,
       description = excluded.description, category = excluded.category`
  )
  for (const batch of chunk(rows, 2000)) {
    db.transaction(() => {
      for (const row of batch) {
        upsert.run(row.epgChannelId, row.start, row.stop, row.title, row.description, row.category)
      }
    })()
  }
}

export function programmesWindow(
  db: AppDatabase,
  epgChannelIds: string[],
  from: number,
  to: number
): EpgProgramme[] {
  if (epgChannelIds.length === 0) return []
  const placeholders = epgChannelIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT * FROM epg_programmes
       WHERE epg_channel_id IN (${placeholders}) AND stop > ? AND start < ?
       ORDER BY epg_channel_id, start`
    )
    .all(...epgChannelIds, from, to) as {
    id: number
    epg_channel_id: string
    start: number
    stop: number
    title: string
    description: string | null
    category: string | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    epgChannelId: r.epg_channel_id,
    start: r.start,
    stop: r.stop,
    title: r.title,
    description: r.description,
    category: r.category
  }))
}

/** Delete programmes that ended more than `keepSecs` ago (default 24h). */
export function purgeOldProgrammes(db: AppDatabase, keepSecs = 86_400): void {
  db.prepare('DELETE FROM epg_programmes WHERE stop < ?').run(
    Math.floor(Date.now() / 1000) - keepSecs
  )
}

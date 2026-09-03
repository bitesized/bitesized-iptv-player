import type { AppDatabase } from '@main/db'
import type { SyncProgress } from '@shared/types'
import { upsertCategories, upsertChannels, upsertSeries, upsertVod } from '@main/db/repos/catalog'
import {
  markProviderSynced,
  setProviderMaxConnections,
  setProviderStatus
} from '@main/db/repos/providers'
import { XtreamClient } from './client'
import type { XtreamCredentials } from './urls'
import {
  normalizeCategory,
  normalizeLiveStream,
  normalizeSeries,
  normalizeVodStream,
  parseMaxConnections
} from './normalize'

export type ProgressFn = (progress: Omit<SyncProgress, 'providerId'>) => void

function notNull<T>(value: T | null): value is T {
  return value !== null
}

/**
 * Full catalog sync for an Xtream provider: categories, then live/VOD/series
 * lists, normalized and diff-upserted into SQLite (soft-deleting removed
 * items). Detail (episodes, VOD info) and EPG are hydrated lazily elsewhere.
 *
 * The three list downloads run sequentially on purpose: Xtream panels enforce
 * connection limits and some count API calls against them.
 */
export async function syncXtreamProvider(
  db: AppDatabase,
  providerId: number,
  creds: XtreamCredentials,
  onProgress: ProgressFn
): Promise<void> {
  const client = new XtreamClient(creds)
  const progress = (p: Partial<Omit<SyncProgress, 'providerId'>>): void =>
    onProgress({ stage: 'connecting', processed: 0, total: null, message: null, ...p })

  setProviderStatus(db, providerId, 'syncing')
  try {
    progress({ stage: 'connecting' })
    const auth = await client.authenticate()
    // Capture the panel's concurrent-connection cap so the player can serialise
    // stream opens against it (see ConnectionLimiter).
    setProviderMaxConnections(db, providerId, parseMaxConnections(auth))

    progress({ stage: 'categories' })
    const [liveCats, vodCats, seriesCats] = [
      await client.getLiveCategories(),
      await client.getVodCategories(),
      await client.getSeriesCategories()
    ]
    const liveCatIds = upsertCategories(
      db,
      providerId,
      'live',
      liveCats.map(normalizeCategory).filter(notNull)
    )
    const vodCatIds = upsertCategories(
      db,
      providerId,
      'vod',
      vodCats.map(normalizeCategory).filter(notNull)
    )
    const seriesCatIds = upsertCategories(
      db,
      providerId,
      'series',
      seriesCats.map(normalizeCategory).filter(notNull)
    )

    progress({ stage: 'live' })
    const liveRows = (await client.getLiveStreams()).map(normalizeLiveStream).filter(notNull)
    progress({ stage: 'live', total: liveRows.length })
    upsertChannels(db, providerId, liveRows, liveCatIds, (processed) =>
      progress({ stage: 'live', processed, total: liveRows.length })
    )

    progress({ stage: 'vod' })
    const vodRows = (await client.getVodStreams()).map(normalizeVodStream).filter(notNull)
    progress({ stage: 'vod', total: vodRows.length })
    upsertVod(db, providerId, vodRows, vodCatIds, (processed) =>
      progress({ stage: 'vod', processed, total: vodRows.length })
    )

    progress({ stage: 'series' })
    const seriesRows = (await client.getSeries()).map(normalizeSeries).filter(notNull)
    progress({ stage: 'series', total: seriesRows.length })
    upsertSeries(db, providerId, seriesRows, seriesCatIds, (processed) =>
      progress({ stage: 'series', processed, total: seriesRows.length })
    )

    progress({ stage: 'finalizing' })
    markProviderSynced(db, providerId)
    progress({ stage: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setProviderStatus(db, providerId, 'error', message)
    progress({ stage: 'error', message })
    throw err
  }
}

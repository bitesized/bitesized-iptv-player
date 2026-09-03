// M3U provider import: stream the playlist (URL or local file), classify
// entries, and diff-upsert into the same channels/vod tables Xtream uses.
// The entry URL doubles as the stable stream_id for diffing.

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { fetch } from 'undici'
import type { AppDatabase } from '@main/db'
import { upsertCategories, upsertChannels, upsertVod } from '@main/db/repos/catalog'
import { markProviderSynced, setProviderStatus } from '@main/db/repos/providers'
import type { ChannelRow, VodRow } from '@main/services/xtream/normalize'
import { parseQuality, parseYear } from '@main/services/xtream/normalize'
import type { ProgressFn } from '@main/services/xtream/sync'
import { classifyEntry, parseM3u } from './parser'
import type { M3uEntry } from './parser'

const USER_AGENT = 'IPTVPlayer/0.1'

async function openLines(source: {
  url: string | null
  filePath: string | null
}): Promise<AsyncIterable<string>> {
  if (source.filePath) {
    return createInterface({ input: createReadStream(source.filePath), crlfDelay: Infinity })
  }
  if (!source.url) throw new Error('Playlist has no URL or file path')
  const response = await fetch(source.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(120_000)
  })
  if (!response.ok || !response.body) {
    throw new Error(`Playlist download failed (HTTP ${response.status})`)
  }
  const nodeStream = Readable.fromWeb(response.body as never)
  return createInterface({ input: nodeStream, crlfDelay: Infinity })
}

function toChannelRow(entry: M3uEntry): ChannelRow {
  return {
    streamId: entry.url,
    name: entry.name,
    logo: entry.attrs['tvg-logo'] ?? null,
    streamType: 'live',
    tvArchive: 0,
    epgChannelId: entry.attrs['tvg-id'] ?? null,
    num: entry.attrs['tvg-chno'] ? Number(entry.attrs['tvg-chno']) || null : null,
    addedAt: null,
    categoryRemoteId: entry.attrs['group-title'] ?? null
  }
}

function toVodRow(entry: M3uEntry): VodRow {
  return {
    streamId: entry.url,
    name: entry.name,
    cover: entry.attrs['tvg-logo'] ?? null,
    rating: null,
    addedAt: null,
    containerExt: /\.([a-z0-9]+)(?:\?.*)?$/i.exec(entry.url)?.[1]?.toLowerCase() ?? null,
    tmdbId: null,
    plot: null,
    durationSecs: entry.durationSecs,
    year: parseYear(entry.name),
    quality: parseQuality(entry.name),
    categoryRemoteId: entry.attrs['group-title'] ?? null
  }
}

export interface M3uSyncResult {
  epgUrl: string | null
}

export async function syncM3uProvider(
  db: AppDatabase,
  providerId: number,
  source: { url: string | null; filePath: string | null },
  onProgress: ProgressFn
): Promise<M3uSyncResult> {
  const progress = (p: Parameters<ProgressFn>[0]): void => onProgress(p)

  setProviderStatus(db, providerId, 'syncing')
  try {
    progress({ stage: 'connecting', processed: 0, total: null, message: null })

    let headerEpgUrl: string | null = null
    const channels: ChannelRow[] = []
    const vod: VodRow[] = []
    let parsed = 0

    const lines = await openLines(source)
    for await (const entry of parseM3u(lines, (header) => {
      headerEpgUrl = header.epgUrl
    })) {
      if (classifyEntry(entry) === 'live') channels.push(toChannelRow(entry))
      else vod.push(toVodRow(entry))
      parsed++
      if (parsed % 5000 === 0) {
        progress({ stage: 'live', processed: parsed, total: null, message: 'Parsing playlist' })
      }
    }

    progress({ stage: 'categories', processed: 0, total: null, message: null })
    const liveCatNames = [...new Set(channels.map((c) => c.categoryRemoteId).filter(Boolean))]
    const vodCatNames = [...new Set(vod.map((v) => v.categoryRemoteId).filter(Boolean))]
    const liveCats = upsertCategories(
      db,
      providerId,
      'live',
      liveCatNames.map((name) => ({ remoteId: name!, name: name! }))
    )
    const vodCats = upsertCategories(
      db,
      providerId,
      'vod',
      vodCatNames.map((name) => ({ remoteId: name!, name: name! }))
    )

    progress({ stage: 'live', processed: 0, total: channels.length, message: null })
    upsertChannels(db, providerId, channels, liveCats, (processed) =>
      progress({ stage: 'live', processed, total: channels.length, message: null })
    )
    progress({ stage: 'vod', processed: 0, total: vod.length, message: null })
    upsertVod(db, providerId, vod, vodCats, (processed) =>
      progress({ stage: 'vod', processed, total: vod.length, message: null })
    )

    progress({ stage: 'finalizing', processed: 0, total: null, message: null })
    markProviderSynced(db, providerId)
    progress({ stage: 'done', processed: 0, total: null, message: null })
    return { epgUrl: headerEpgUrl }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setProviderStatus(db, providerId, 'error', message)
    progress({ stage: 'error', processed: 0, total: null, message })
    throw err
  }
}

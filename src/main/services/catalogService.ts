// Detail hydration and stream URL resolution. Needs provider credentials, so
// it lives in main (never the renderer).

import type { AppDatabase } from '@main/db'
import {
  getChannelById,
  getEpisodeById,
  getSeriesById,
  getVodById,
  listEpisodes
} from '@main/db/repos/browse'
import { upsertEpisodes } from '@main/db/repos/catalog'
import { getProvider, getProviderPassword } from '@main/db/repos/providers'
import { decryptSecret } from '@main/security/credentials'
import { XtreamClient } from './xtream/client'
import { normalizeEpisode, normalizeVodSubtitles, asNumber } from './xtream/normalize'
import type { VodSubtitle } from './xtream/normalize'
import type { XtreamCredentials } from './xtream/urls'
import {
  formatTimeshiftStart,
  liveStreamUrl,
  seriesEpisodeUrl,
  timeshiftUrl,
  vodStreamUrl
} from './xtream/urls'
import type { Episode } from '@shared/types'
import type { XtreamEpisode } from './xtream/types'

export function getXtreamCredentials(db: AppDatabase, providerId: number): XtreamCredentials {
  const provider = getProvider(db, providerId)
  const encPassword = getProviderPassword(db, providerId)
  if (!provider || provider.type !== 'xtream' || !provider.baseUrl || !provider.username) {
    throw new Error('Provider is not a configured Xtream account')
  }
  if (!encPassword) throw new Error('Provider credentials are missing')
  return {
    baseUrl: provider.baseUrl,
    username: provider.username,
    password: decryptSecret(encPassword)
  }
}

/**
 * Episodes for a series — served from cache, hydrated from get_series_info on
 * first access.
 */
export async function getEpisodes(db: AppDatabase, seriesId: number): Promise<Episode[]> {
  const cached = listEpisodes(db, seriesId)
  if (cached.length > 0) return cached

  const series = getSeriesById(db, seriesId)
  if (!series) throw new Error('Series not found')

  const creds = getXtreamCredentials(db, series.providerId)
  const info = await new XtreamClient(creds).getSeriesInfo(series.seriesId)

  const rows = []
  const seasons = info.episodes ?? {}
  const entries: [string, XtreamEpisode[]][] = Array.isArray(seasons)
    ? seasons.map((eps, i) => [String(i), eps])
    : Object.entries(seasons)
  for (const [seasonKey, episodes] of entries) {
    if (!Array.isArray(episodes)) continue
    const season = asNumber(seasonKey) ?? 0
    for (const raw of episodes) {
      const row = normalizeEpisode(raw, season)
      if (row) rows.push(row)
    }
  }
  upsertEpisodes(db, seriesId, rows)
  return listEpisodes(db, seriesId)
}

/** For M3U providers the entry URL itself is stored as stream_id. */
function isM3uProvider(db: AppDatabase, providerId: number): boolean {
  return getProvider(db, providerId)?.type === 'm3u'
}

/**
 * External subtitle tracks for an Xtream VOD item, from get_vod_info. Returns
 * direct URLs (the IPC layer proxies them so mpv fetches via 127.0.0.1). Empty
 * for M3U providers or when the panel exposes none.
 */
export async function getVodSubtitles(db: AppDatabase, vodId: number): Promise<VodSubtitle[]> {
  const vod = getVodById(db, vodId)
  if (!vod) throw new Error('Movie not found')
  if (isM3uProvider(db, vod.providerId)) return []
  const creds = getXtreamCredentials(db, vod.providerId)
  const info = await new XtreamClient(creds).getVodInfo(vod.streamId)
  return normalizeVodSubtitles(info)
}

function extFromUrl(url: string): string | null {
  return /\.([a-z0-9]+)(?:\?.*)?$/i.exec(url)?.[1]?.toLowerCase() ?? null
}

/**
 * Resolve the direct provider URL for an item (proxying is applied by the
 * IPC layer so the renderer only ever sees 127.0.0.1).
 */
export function resolveStreamUrl(
  db: AppDatabase,
  itemType: 'live' | 'vod' | 'episode',
  itemId: number,
  preferredExt?: string
): { url: string; containerExt: string | null; providerId: number } {
  if (itemType === 'live') {
    const channel = getChannelById(db, itemId)
    if (!channel) throw new Error('Channel not found')
    if (isM3uProvider(db, channel.providerId)) {
      return {
        url: channel.streamId,
        containerExt: extFromUrl(channel.streamId),
        providerId: channel.providerId
      }
    }
    const creds = getXtreamCredentials(db, channel.providerId)
    const ext = preferredExt === 'm3u8' ? 'm3u8' : 'ts'
    return {
      url: liveStreamUrl(creds, channel.streamId, ext),
      containerExt: ext,
      providerId: channel.providerId
    }
  }
  if (itemType === 'vod') {
    const vod = getVodById(db, itemId)
    if (!vod) throw new Error('Movie not found')
    if (isM3uProvider(db, vod.providerId)) {
      return {
        url: vod.streamId,
        containerExt: vod.containerExt ?? extFromUrl(vod.streamId),
        providerId: vod.providerId
      }
    }
    const creds = getXtreamCredentials(db, vod.providerId)
    const ext = preferredExt ?? vod.containerExt ?? 'mp4'
    return {
      url: vodStreamUrl(creds, vod.streamId, ext),
      containerExt: ext,
      providerId: vod.providerId
    }
  }
  const episode = getEpisodeById(db, itemId)
  if (!episode) throw new Error('Episode not found')
  const creds = getXtreamCredentials(db, episode.providerId)
  const ext = preferredExt ?? episode.containerExt ?? 'mp4'
  return {
    url: seriesEpisodeUrl(creds, episode.remoteId, ext),
    containerExt: ext,
    providerId: episode.providerId
  }
}

/**
 * Resolve a catch-up/timeshift URL for a past programme on an archived channel
 * (`tv_archive=1`). Xtream only — M3U playlists carry no timeshift endpoint.
 */
export function resolveTimeshiftUrl(
  db: AppDatabase,
  channelId: number,
  startSecs: number,
  durationMinutes: number
): { url: string; containerExt: string | null; providerId: number } {
  const channel = getChannelById(db, channelId)
  if (!channel) throw new Error('Channel not found')
  if (isM3uProvider(db, channel.providerId)) {
    throw new Error('Catch-up is only available on Xtream channels')
  }
  const creds = getXtreamCredentials(db, channel.providerId)
  const start = formatTimeshiftStart(new Date(startSecs * 1000))
  const url = timeshiftUrl(creds, channel.streamId, start, Math.max(1, Math.round(durationMinutes)))
  // Xtream timeshift returns MPEG-TS; hint 'ts' so the web fallback picks mpegts.
  return { url, containerExt: 'ts', providerId: channel.providerId }
}

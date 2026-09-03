// Defensive coercion of raw Xtream payloads into normalized row shapes.
// Providers return numbers as strings, omit fields, or send garbage — every
// accessor here tolerates that.

import type {
  XtreamAuthResponse,
  XtreamCategory,
  XtreamEpisode,
  XtreamLiveStream,
  XtreamSeriesListItem,
  XtreamVodInfo,
  XtreamVodStream
} from './types'

export function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function asBool(value: unknown): boolean {
  const num = asNumber(value)
  if (num !== null) return num !== 0
  return value === true
}

/**
 * Concurrent-connection cap from an auth response. Panels commonly report `0`
 * for "unlimited" (and some omit it) — both map to `null` so the queue treats
 * the provider as uncapped rather than blocking every open.
 */
export function parseMaxConnections(auth: XtreamAuthResponse): number | null {
  const max = asNumber(auth.user_info?.max_connections)
  return max !== null && max > 0 ? Math.round(max) : null
}

export interface VodSubtitle {
  url: string
  label: string
  language: string | null
}

/**
 * External subtitles from a get_vod_info payload. Panels are inconsistent —
 * entries may be plain URL strings or objects keyed url/src/file with
 * language/lang and name/title. Only absolute http(s) URLs are kept.
 */
export function normalizeVodSubtitles(info: XtreamVodInfo): VodSubtitle[] {
  const raw = info.info?.subtitles
  if (!Array.isArray(raw)) return []
  const out: VodSubtitle[] = []
  for (const entry of raw) {
    let url: string | null = null
    let language: string | null = null
    let name: string | null = null
    if (typeof entry === 'string') {
      url = asString(entry)
    } else if (entry && typeof entry === 'object') {
      const rec = entry as Record<string, unknown>
      url = asString(rec['url'] ?? rec['src'] ?? rec['file'] ?? rec['link'])
      language = asString(rec['language'] ?? rec['lang'])
      name = asString(rec['name'] ?? rec['title'])
    }
    if (!url || !/^https?:\/\//i.test(url)) continue
    out.push({ url, language, label: name ?? language ?? 'Subtitle' })
  }
  return out
}

/** Epoch seconds from Xtream 'added' fields (usually a string epoch). */
export function asEpoch(value: unknown): number | null {
  const num = asNumber(value)
  if (num === null) return null
  // Some panels return milliseconds.
  return num > 10_000_000_000 ? Math.round(num / 1000) : Math.round(num)
}

// --- Normalized row shapes (match SQLite columns) -------------------------

export interface CategoryRow {
  remoteId: string
  name: string
}

export interface ChannelRow {
  streamId: string
  name: string
  logo: string | null
  streamType: string | null
  tvArchive: number
  epgChannelId: string | null
  num: number | null
  addedAt: number | null
  categoryRemoteId: string | null
}

export interface VodRow {
  streamId: string
  name: string
  cover: string | null
  rating: number | null
  addedAt: number | null
  containerExt: string | null
  tmdbId: string | null
  plot: string | null
  durationSecs: number | null
  year: number | null
  quality: string | null
  categoryRemoteId: string | null
}

/** Release year parsed from a title (last plausible 4-digit year, 1900–2099). */
export function parseYear(name: string): number | null {
  const matches = name.match(/\b(?:19|20)\d{2}\b/g)
  if (!matches) return null
  const year = Number(matches[matches.length - 1])
  return year >= 1900 && year <= 2099 ? year : null
}

/** Quality bucket parsed from a title: '4K' | '1080p' | '720p' | 'SD' | null. */
export function parseQuality(name: string): string | null {
  const n = name.toLowerCase()
  if (/\b(4k|2160p|uhd)\b/.test(n)) return '4K'
  if (/\b(1080p|fhd)\b/.test(n)) return '1080p'
  if (/\b(720p|hd)\b/.test(n)) return '720p'
  if (/\b(480p|360p|sd)\b/.test(n)) return 'SD'
  return null
}

export interface SeriesRow {
  seriesId: string
  name: string
  cover: string | null
  plot: string | null
  rating: number | null
  genre: string | null
  releaseDate: string | null
  addedAt: number | null
  categoryRemoteId: string | null
}

export interface EpisodeRow {
  season: number
  episodeNum: number
  remoteId: string
  title: string | null
  containerExt: string | null
  durationSecs: number | null
  plot: string | null
  still: string | null
}

// --- Normalizers ----------------------------------------------------------

export function normalizeCategory(raw: XtreamCategory): CategoryRow | null {
  const remoteId = asString(raw.category_id)
  const name = asString(raw.category_name)
  if (remoteId === null || name === null) return null
  return { remoteId, name }
}

export function normalizeLiveStream(raw: XtreamLiveStream): ChannelRow | null {
  const streamId = asString(raw.stream_id)
  const name = asString(raw.name)
  if (streamId === null || name === null) return null
  return {
    streamId,
    name,
    logo: asString(raw.stream_icon),
    streamType: asString(raw.stream_type),
    tvArchive: asBool(raw.tv_archive) ? 1 : 0,
    epgChannelId: asString(raw.epg_channel_id),
    num: asNumber(raw.num),
    addedAt: asEpoch(raw.added),
    categoryRemoteId: asString(raw.category_id)
  }
}

export function normalizeVodStream(raw: XtreamVodStream): VodRow | null {
  const streamId = asString(raw.stream_id)
  const name = asString(raw.name)
  if (streamId === null || name === null) return null
  return {
    streamId,
    name,
    cover: asString(raw.stream_icon),
    rating: asNumber(raw.rating),
    addedAt: asEpoch(raw.added),
    containerExt: asString(raw.container_extension),
    tmdbId: asString(raw.tmdb_id),
    plot: asString(raw.plot),
    durationSecs: asNumber(raw.duration_secs),
    year: parseYear(name),
    quality: parseQuality(name),
    categoryRemoteId: asString(raw.category_id)
  }
}

export function normalizeSeries(raw: XtreamSeriesListItem): SeriesRow | null {
  const seriesId = asString(raw.series_id)
  const name = asString(raw.name)
  if (seriesId === null || name === null) return null
  return {
    seriesId,
    name,
    cover: asString(raw.cover),
    plot: asString(raw.plot),
    rating: asNumber(raw.rating),
    genre: asString(raw.genre),
    releaseDate: asString(raw.releaseDate) ?? asString(raw.release_date),
    addedAt: asEpoch(raw.last_modified),
    categoryRemoteId: asString(raw.category_id)
  }
}

export function normalizeEpisode(raw: XtreamEpisode, season: number): EpisodeRow | null {
  const remoteId = asString(raw.id)
  const episodeNum = asNumber(raw.episode_num)
  if (remoteId === null || episodeNum === null) return null
  return {
    season: asNumber(raw.season) ?? season,
    episodeNum,
    remoteId,
    title: asString(raw.title),
    containerExt: asString(raw.container_extension),
    durationSecs: asNumber(raw.info?.duration_secs),
    plot: asString(raw.info?.plot),
    still: asString(raw.info?.movie_image)
  }
}

// Domain models shared between main and renderer.
// These mirror the SQLite schema in normalized, camelCase form.

export type ProviderType = 'xtream' | 'm3u'
export type ProviderStatus = 'ok' | 'syncing' | 'error' | 'never_synced'
export type ContentKind = 'live' | 'vod' | 'series'

export interface Provider {
  id: number
  type: ProviderType
  name: string
  baseUrl: string | null
  username: string | null
  /**
   * Playlist URL with credentials masked — for display only. The real value
   * never leaves main: in plaintext it grants full access to the subscription.
   */
  m3uUrl: string | null
  /** EPG URL with credentials masked; display only, as with `m3uUrl`. */
  epgUrl: string | null
  /** Whether an EPG URL is configured (the masked value is not a valid check). */
  hasEpgUrl: boolean
  lastSyncAt: number | null
  status: ProviderStatus
  statusMessage: string | null
  /** Concurrent-connection cap from the panel (Xtream `max_connections`); null
   * when unknown/unlimited. Drives the per-provider stream-open queue. */
  maxConnections: number | null
}

export interface Profile {
  id: number
  name: string
  avatar: string | null
  isKids: boolean
  hasPin: boolean
}

export interface Category {
  id: number
  providerId: number
  kind: ContentKind
  remoteId: string
  name: string
  itemCount?: number
  /** Per-profile: hidden from the sidebar in normal mode. */
  hidden?: boolean
  /** Per-profile manual sort position; null = alphabetical fallback. */
  position?: number | null
}

export interface Channel {
  id: number
  providerId: number
  categoryId: number | null
  streamId: string
  name: string
  logo: string | null
  streamType: string | null
  tvArchive: boolean
  epgChannelId: string | null
  num: number | null
  addedAt: number | null
}

export interface VodItem {
  id: number
  providerId: number
  categoryId: number | null
  streamId: string
  name: string
  cover: string | null
  rating: number | null
  addedAt: number | null
  containerExt: string | null
  tmdbId: string | null
  plot: string | null
  durationSecs: number | null
  /** Release year parsed from the title (for search filters). */
  year?: number | null
  /** Quality bucket parsed from the title: '4K' | '1080p' | '720p' | 'SD'. */
  quality?: string | null
}

export interface Series {
  id: number
  providerId: number
  categoryId: number | null
  seriesId: string
  name: string
  cover: string | null
  plot: string | null
  rating: number | null
  genre: string | null
  releaseDate: string | null
  addedAt: number | null
}

export interface Episode {
  id: number
  seriesId: number
  season: number
  episodeNum: number
  remoteId: string
  title: string | null
  containerExt: string | null
  durationSecs: number | null
  plot: string | null
  still: string | null
}

export interface EpgProgramme {
  id: number
  epgChannelId: string
  start: number
  stop: number
  title: string
  description: string | null
  category: string | null
}

export interface Favorite {
  profileId: number
  itemType: ContentKind
  itemId: number
  createdAt: number
}

/**
 * A favorite hydrated for display: the item's name/artwork plus the provider
 * category it belongs to, so favorites can be grouped by type and category
 * without the renderer resolving each id itself.
 */
export interface FavoriteEntry {
  itemType: ContentKind
  itemId: number
  providerId: number
  name: string
  /** Channel logo or poster, when the provider supplies one. */
  image: string | null
  categoryId: number | null
  categoryName: string | null
  createdAt: number
}

export interface WatchHistoryEntry {
  profileId: number
  itemType: 'vod' | 'episode' | 'live'
  itemId: number
  positionSecs: number
  durationSecs: number | null
  updatedAt: number
  completed: boolean
}

/** A continue-watching row hydrated for display. */
export interface ContinueWatchingItem {
  itemType: 'vod' | 'episode'
  itemId: number
  name: string
  cover: string | null
  positionSecs: number
  durationSecs: number | null
  updatedAt: number
  /** For episodes: parent series (used for navigation/labels). */
  seriesId?: number
  seriesName?: string
  season?: number
  episodeNum?: number
}

// --- Pagination -----------------------------------------------------------

/** Keyset-paginated page. `nextCursor` is null when the end is reached. */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface PageRequest {
  cursor: string | null
  limit: number
}

// --- Sync progress --------------------------------------------------------

export type SyncStage =
  'connecting' | 'categories' | 'live' | 'vod' | 'series' | 'epg' | 'finalizing' | 'done' | 'error'

export interface SyncProgress {
  providerId: number
  stage: SyncStage
  /** Items processed in the current stage. */
  processed: number
  /** Total items in the current stage, when known. */
  total: number | null
  message: string | null
}

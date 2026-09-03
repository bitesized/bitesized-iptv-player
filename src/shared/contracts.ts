// Typed IPC contracts. Every channel is declared here once; main registers
// handlers against this map and the preload/renderer client is derived from it,
// so a channel cannot drift between processes.

import type { PlayerCommand, PlayerEventPayload } from './player'
import type {
  Category,
  Channel,
  ContentKind,
  ContinueWatchingItem,
  Episode,
  EpgProgramme,
  FavoriteEntry,
  Page,
  PageRequest,
  Profile,
  Provider,
  Series,
  SyncProgress,
  VodItem
} from './types'

// --- Wire shapes ----------------------------------------------------------

/**
 * Catalog rows as the renderer sees them. Two things are removed on the way
 * out of main:
 *
 * - the provider stream locator (`streamId`/`seriesId`/`remoteId`). For M3U
 *   providers that field *is* the credentialed playlist URL. The UI never reads
 *   it — playback goes through `stream:url`, which resolves and proxies in main.
 * - artwork is rewritten to a local proxy URL, so provider and third-party
 *   image hosts never see the user's IP and a playlist-supplied `tvg-logo`
 *   can't act as a browse-time tracking beacon.
 */
export type PublicChannel = Omit<Channel, 'streamId'>
export type PublicVodItem = Omit<VodItem, 'streamId'>
export type PublicSeries = Omit<Series, 'seriesId'>
export type PublicEpisode = Omit<Episode, 'remoteId'>

// --- Request payloads -----------------------------------------------------

export interface AddXtreamProviderInput {
  name: string
  baseUrl: string
  username: string
  password: string
}

export interface AddM3uProviderInput {
  name: string
  /** Remote playlist URL, or null when importing from a local file. */
  url: string | null
  /** Absolute path of a local playlist file, when importing from disk. */
  filePath: string | null
  epgUrl: string | null
}

export interface BrowseQuery extends PageRequest {
  providerId?: number
  /** Numeric category id, or a virtual category. */
  categoryId?: number | 'all' | 'favorites' | 'recent' | 'uncategorized'
  sort?: 'name' | 'added' | 'num'
  profileId?: number
}

export interface SearchQuery extends PageRequest {
  term: string
  kind: ContentKind
  providerId?: number
  profileId?: number
  // Optional filters combinable with the FTS term:
  /** Movies (vod): exact release year. */
  year?: number
  /** Movies (vod): quality bucket ('4K' | '1080p' | '720p' | 'SD'). */
  quality?: string
  /** Series: genre substring match. */
  genre?: string
}

export interface FavoriteToggleInput {
  profileId: number
  itemType: ContentKind
  itemId: number
}

export interface HistoryUpsertInput {
  profileId: number
  itemType: 'vod' | 'episode' | 'live'
  itemId: number
  positionSecs: number
  durationSecs: number | null
}

export interface EpgWindowQuery {
  epgChannelIds: string[]
  /** Unix seconds, inclusive window start. */
  from: number
  /** Unix seconds, exclusive window end. */
  to: number
}

// --- The channel map ------------------------------------------------------

/**
 * Every invoke/handle channel: request payload → response type.
 * Channel names are namespaced `domain:verb`.
 */
export interface IpcContracts {
  'app:version': { req: void; res: string }

  'providers:list': { req: void; res: Provider[] }
  'providers:addXtream': { req: AddXtreamProviderInput; res: Provider }
  'providers:addM3u': { req: AddM3uProviderInput; res: Provider }
  'providers:delete': { req: { providerId: number }; res: void }
  'providers:sync': { req: { providerId: number }; res: void }
  'providers:setEpgUrl': { req: { providerId: number; epgUrl: string | null }; res: void }
  /** Re-ingest the provider's XMLTV EPG now; resolves with programme count. */
  'providers:refreshEpg': { req: { providerId: number }; res: { programmes: number } }

  /** Native open-dialog for a local .m3u/.m3u8 playlist; null when cancelled. */
  'dialog:pickPlaylist': { req: void; res: string | null }

  'categories:list': {
    req: { providerId?: number; kind: ContentKind; profileId?: number }
    res: Category[]
  }
  /** Hide/unhide a category for a profile. */
  'categories:setHidden': {
    req: { profileId: number; categoryId: number; hidden: boolean }
    res: void
  }
  /** Persist a manual category order (ids in display order) for a profile. */
  'categories:reorder': { req: { profileId: number; orderedIds: number[] }; res: void }

  'channels:page': { req: BrowseQuery; res: Page<PublicChannel> }
  /** Prev/next channel ids in Live-list order (num, then id) for zapping. */
  'channels:adjacent': {
    req: { channelId: number }
    res: { prevId: number | null; nextId: number | null }
  }
  'vod:page': { req: BrowseQuery; res: Page<PublicVodItem> }
  'vod:detail': { req: { vodId: number }; res: PublicVodItem }
  'series:page': { req: BrowseQuery; res: Page<PublicSeries> }
  'series:detail': { req: { seriesId: number }; res: PublicSeries }
  /**
   * External subtitle tracks for a VOD item (Xtream get_vod_info), as proxied
   * URLs the player can side-load. Empty for M3U or when none are exposed.
   */
  'vod:subtitles': {
    req: { vodId: number }
    res: { subtitles: { url: string; label: string; language: string | null }[] }
  }
  /** Episodes for a series; lazily hydrated from the provider on first access. */
  'series:episodes': { req: { seriesId: number }; res: PublicEpisode[] }
  /** The episode after this one (same season, then next season), if any. */
  'episodes:next': { req: { episodeId: number }; res: { nextEpisodeId: number | null } }

  /**
   * Resolve a playable URL for an item. The URL is always minted on the local
   * stream proxy — neither the renderer nor the player talks to a provider host.
   */
  'stream:url': {
    req: { itemType: 'live' | 'vod' | 'episode'; itemId: number; preferredExt?: string }
    res: { url: string; containerExt: string | null; providerId: number }
  }

  /**
   * Resolve a catch-up/timeshift URL for a past programme on an archived
   * channel (`tv_archive=1`). Xtream only; throws for M3U providers.
   */
  'stream:timeshift': {
    req: { channelId: number; startSecs: number; durationMinutes: number }
    res: { url: string; containerExt: string | null; providerId: number }
  }

  'search:query': {
    req: SearchQuery
    res: Page<PublicChannel | PublicVodItem | PublicSeries>
  }

  'profiles:list': { req: void; res: Profile[] }
  'profiles:create': {
    req: { name: string; avatar: string | null; isKids: boolean; pin: string | null }
    res: Profile
  }
  'profiles:delete': { req: { profileId: number }; res: void }
  'profiles:verifyPin': { req: { profileId: number; pin: string }; res: { ok: boolean } }

  'favorites:toggle': { req: FavoriteToggleInput; res: { favorited: boolean } }
  'favorites:list': {
    req: { profileId: number; itemType?: ContentKind }
    res: { itemType: ContentKind; itemId: number }[]
  }
  /**
   * Favorites hydrated with name/artwork and their provider category, for the
   * grouped favorites view (`favorites:list` returns bare ids).
   */
  'favorites:detailed': {
    req: { profileId: number; providerId?: number }
    res: FavoriteEntry[]
  }

  'history:upsert': { req: HistoryUpsertInput; res: void }
  /** Remove one item from watch history / continue-watching. */
  'history:remove': {
    req: { profileId: number; itemType: 'vod' | 'episode' | 'live'; itemId: number }
    res: void
  }
  'history:position': {
    req: { profileId: number; itemType: 'vod' | 'episode'; itemId: number }
    res: number | null
  }
  'history:continueWatching': {
    req: { profileId: number; limit: number }
    res: ContinueWatchingItem[]
  }

  'epg:window': { req: EpgWindowQuery; res: EpgProgramme[] }
  /** Fetch + cache the provider EPG table for one channel (TTL-deduped). */
  'epg:hydrate': { req: { channelId: number }; res: void }
  /** Cached now/next programmes for a set of channels (no provider fetch). */
  'epg:nowNext': {
    req: { channelIds: number[] }
    res: { channelId: number; now: EpgProgramme | null; next: EpgProgramme | null }[]
  }

  'settings:get': { req: { key: string }; res: string | null }
  'settings:set': { req: { key: string; value: string }; res: void }

  // --- Native player (mpv) bridge ----------------------------------------

  /**
   * Which engine should the player screen use, and (for mpv) does it render
   * embedded in the app window? When `embedded` is true the renderer keeps its
   * player surface transparent so the natively-drawn video shows through.
   */
  'player:capabilities': { req: void; res: { engine: 'mpv' | 'web'; embedded: boolean } }
  /**
   * Start (if needed) and load a stream into the native player. `providerId`
   * lets main reserve a connection slot for the provider (respecting its
   * `max_connections` cap); a `CONNECTION_LIMIT` error is thrown when the cap is
   * already met.
   */
  'player:load': {
    req: { url: string; startSecs?: number; live: boolean; providerId?: number }
    res: void
  }
  'player:command': { req: PlayerCommand; res: void }
  /** Tear down the native player surface (leaving the player screen). */
  'player:stop': { req: void; res: void }

  // --- Window ------------------------------------------------------------

  /**
   * Drive the app window's native fullscreen. The player owns this (rather than
   * letting mpv toggle its own fullscreen) so the embedded video view and the
   * DOM controls resize together. The macOS transition is animated/async, so the
   * resulting state arrives via the `window:fullscreen` push event, not here.
   */
  'window:setFullscreen': { req: { fullscreen: boolean }; res: void }
  /** Current fullscreen state, for initialising UI on the player screen. */
  'window:isFullscreen': { req: void; res: boolean }
}

export type IpcChannel = keyof IpcContracts
export type IpcRequest<C extends IpcChannel> = IpcContracts[C]['req']
export type IpcResponse<C extends IpcChannel> = IpcContracts[C]['res']

/**
 * Runtime list of every contract channel. The type assertions below force a
 * compile error if this list and IpcContracts ever drift apart, and tests use
 * it to prove main registers a handler for every channel.
 */
export const IPC_CHANNELS = [
  'app:version',
  'providers:list',
  'providers:addXtream',
  'providers:addM3u',
  'providers:delete',
  'providers:sync',
  'providers:setEpgUrl',
  'providers:refreshEpg',
  'dialog:pickPlaylist',
  'categories:list',
  'categories:setHidden',
  'categories:reorder',
  'channels:page',
  'channels:adjacent',
  'vod:page',
  'vod:detail',
  'series:page',
  'series:detail',
  'vod:subtitles',
  'series:episodes',
  'episodes:next',
  'stream:url',
  'stream:timeshift',
  'search:query',
  'profiles:list',
  'profiles:create',
  'profiles:delete',
  'profiles:verifyPin',
  'favorites:toggle',
  'favorites:list',
  'favorites:detailed',
  'history:upsert',
  'history:remove',
  'history:position',
  'history:continueWatching',
  'epg:window',
  'epg:hydrate',
  'epg:nowNext',
  'settings:get',
  'settings:set',
  'player:capabilities',
  'player:load',
  'player:command',
  'player:stop',
  'window:setFullscreen',
  'window:isFullscreen'
] as const satisfies readonly IpcChannel[]

type UnlistedChannel = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>
// If this errors, a channel was added to IpcContracts but not IPC_CHANNELS.
const _allChannelsListed: UnlistedChannel extends never ? true : UnlistedChannel = true
void _allChannelsListed

// --- Push events (main → renderer, fire-and-forget) -----------------------

export interface IpcEvents {
  'sync:progress': SyncProgress
  'player:event': PlayerEventPayload
  /** Fires whenever the window enters/leaves fullscreen (incl. the macOS
   * green-button / Ctrl+Cmd+F), so the UI can track state it didn't initiate. */
  'window:fullscreen': boolean
}

export type IpcEventChannel = keyof IpcEvents
export type IpcEventPayload<C extends IpcEventChannel> = IpcEvents[C]

// --- The surface exposed on window.api ------------------------------------

export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>
  on<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventPayload<C>) => void
  ): () => void
}

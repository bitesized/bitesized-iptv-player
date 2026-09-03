import { app, BrowserWindow, dialog, powerSaveBlocker } from 'electron'
import type { AppDatabase } from '@main/db'
import {
  deleteProvider,
  getProvider,
  getProviderUrls,
  insertM3uProvider,
  insertXtreamProvider,
  listProviderOrigins,
  listProviders,
  setProviderEpgUrl,
  setProviderMaxConnections
} from '@main/db/repos/providers'
import {
  adjacentChannels,
  getChannelsByIds,
  getEpisodeById,
  getSeriesById,
  getVodById,
  listCategories,
  listEpisodes,
  pageChannels,
  pageSeries,
  pageVod,
  reorderCategories,
  search,
  setCategoryHidden
} from '@main/db/repos/browse'
import {
  continueWatching,
  getResumePosition,
  listFavorites,
  listFavoritesDetailed,
  removeHistory,
  toggleFavorite,
  upsertHistory
} from '@main/db/repos/library'
import { programmesWindow } from '@main/db/repos/epg'
import {
  createProfile,
  deleteProfile,
  listProfiles,
  verifyProfilePin
} from '@main/db/repos/profiles'
import { encryptSecret } from '@main/security/credentials'
import type { EpgService } from '@main/services/epg/epgService'
import { discoverMpvBinary, MpvController } from '@main/services/player/mpvController'
import {
  EmbeddedMpvController,
  isEmbeddedMpvAvailable
} from '@main/services/player/embeddedMpvController'
import { ConnectionLimiter, type ConnectionRelease } from '@main/services/player/connectionLimiter'
import type { StreamProxy } from '@main/services/proxy/streamProxy'
import { effectiveEpgChannelId } from '@shared/epg'
import type { Channel, EpgProgramme, Series, VodItem } from '@shared/types'
import {
  mapPage,
  publicChannel,
  publicContinueWatching,
  publicEpisode,
  publicFavorite,
  publicSeries,
  publicVod
} from './publicShapes'
import {
  getEpisodes,
  getVodSubtitles,
  resolveStreamUrl,
  resolveTimeshiftUrl
} from '@main/services/catalogService'
import type { SyncManager } from '@main/services/syncManager'
import { XtreamClient } from '@main/services/xtream/client'
import { normalizeBaseUrl } from '@main/services/xtream/urls'
import { parseMaxConnections } from '@main/services/xtream/normalize'
import { handle } from './registry'

/** Register all IPC handlers. Called once at startup. */
export function registerIpcHandlers(
  db: AppDatabase,
  syncManager: SyncManager,
  epgService: EpgService,
  streamProxy: StreamProxy
): void {
  handle('app:version', () => app.getVersion())

  // Hosts the user configured are the ones the proxy may reach without the
  // private-address guard, so a self-hosted provider on the LAN keeps working.
  // Kept in sync with the provider list rather than read per request.
  const refreshTrustedOrigins = (): void => streamProxy.setTrustedOrigins(listProviderOrigins(db))
  refreshTrustedOrigins()

  // --- EPG ----------------------------------------------------------------

  handle('epg:window', ({ epgChannelIds, from, to }) =>
    programmesWindow(db, epgChannelIds, from, to)
  )
  handle('epg:hydrate', ({ channelId }) => epgService.hydrateChannel(channelId))
  handle('epg:nowNext', ({ channelIds }) => {
    const now = Math.floor(Date.now() / 1000)
    const channels = getChannelsByIds(db, channelIds)
    const byEpgId = new Map(channels.map((c) => [effectiveEpgChannelId(c), c.id]))
    const programmes = programmesWindow(db, [...byEpgId.keys()], now, now + 12 * 3600)

    const result = new Map<number, { now: EpgProgramme | null; next: EpgProgramme | null }>()
    for (const channel of channels) {
      result.set(channel.id, { now: null, next: null })
    }
    for (const programme of programmes) {
      const channelId = byEpgId.get(programme.epgChannelId)
      if (channelId === undefined) continue
      const slot = result.get(channelId)!
      if (programme.start <= now && programme.stop > now) slot.now = programme
      else if (programme.start > now && slot.next === null) slot.next = programme
    }
    return [...result.entries()].map(([channelId, slot]) => ({ channelId, ...slot }))
  })

  // --- Providers ----------------------------------------------------------

  handle('providers:list', () => listProviders(db))

  handle('providers:addXtream', async (input) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const creds = { baseUrl, username: input.username, password: input.password }
    // Validate before persisting so a typo'd host/password fails fast.
    const auth = await new XtreamClient(creds).authenticate()

    const provider = insertXtreamProvider(db, {
      name: input.name.trim() || baseUrl,
      baseUrl,
      username: input.username,
      encPassword: encryptSecret(input.password)
    })
    // Record the connection cap up front so the queue is correct even before the
    // first full sync re-authenticates.
    setProviderMaxConnections(db, provider.id, parseMaxConnections(auth))
    refreshTrustedOrigins()
    // Kick off the first import in the background; UI follows sync:progress.
    void syncManager.syncProvider(provider.id).catch(() => {})
    return provider
  })

  handle('providers:addM3u', (input) => {
    if (!input.url && !input.filePath) {
      throw new Error('Provide a playlist URL or file')
    }
    const provider = insertM3uProvider(db, {
      name: input.name.trim() || 'M3U Playlist',
      // Local file paths share the m3u_url column (distinguished by scheme).
      m3uUrl: input.url ?? input.filePath,
      epgUrl: input.epgUrl
    })
    refreshTrustedOrigins()
    void syncManager.syncProvider(provider.id).catch(() => {})
    return provider
  })

  handle('providers:delete', async ({ providerId }) => {
    // Stop any in-flight import first: the sync worker holds its own DB
    // connection and would keep writing rows (channels/vod/…) for a provider we
    // are about to delete, orphaning them or racing the cascade delete.
    await syncManager.cancelSync(providerId)
    deleteProvider(db, providerId)
    refreshTrustedOrigins()
  })

  handle('providers:sync', async ({ providerId }) => {
    await syncManager.syncProvider(providerId)
  })

  handle('providers:setEpgUrl', ({ providerId, epgUrl }) => {
    setProviderEpgUrl(db, providerId, epgUrl)
    refreshTrustedOrigins()
  })

  handle('providers:refreshEpg', async ({ providerId }) => {
    const { epgUrl } = getProviderUrls(db, providerId)
    if (!epgUrl) throw new Error('This provider has no EPG URL configured')
    const programmes = await epgService.ingestXmltv(epgUrl)
    return { programmes }
  })

  handle('dialog:pickPlaylist', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await dialog.showOpenDialog(win as Electron.BrowserWindow, {
      title: 'Choose an M3U playlist',
      properties: ['openFile'],
      filters: [
        { name: 'Playlists', extensions: ['m3u', 'm3u8'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // --- Browse -------------------------------------------------------------

  handle('categories:list', ({ kind, providerId, profileId }) =>
    listCategories(db, kind, providerId, profileId)
  )
  handle('categories:setHidden', ({ profileId, categoryId, hidden }) =>
    setCategoryHidden(db, profileId, categoryId, hidden)
  )
  handle('categories:reorder', ({ profileId, orderedIds }) =>
    reorderCategories(db, profileId, orderedIds)
  )
  // Catalog rows leave main only through the publicShapes mappers: they drop
  // the provider stream locator and rewrite artwork onto the local proxy.
  handle('channels:page', (query) =>
    mapPage(pageChannels(db, query), (row) => publicChannel(streamProxy, row))
  )
  handle('channels:adjacent', ({ channelId }) => adjacentChannels(db, channelId))
  handle('vod:page', (query) => mapPage(pageVod(db, query), (row) => publicVod(streamProxy, row)))
  handle('series:page', (query) =>
    mapPage(pageSeries(db, query), (row) => publicSeries(streamProxy, row))
  )
  handle('search:query', (query) => {
    const page = search(db, query)
    return mapPage(page, (row) => {
      if (query.kind === 'live') return publicChannel(streamProxy, row as Channel)
      if (query.kind === 'vod') return publicVod(streamProxy, row as VodItem)
      return publicSeries(streamProxy, row as Series)
    })
  })

  handle('vod:detail', ({ vodId }) => {
    const vod = getVodById(db, vodId)
    if (!vod) throw new Error('Movie not found')
    return publicVod(streamProxy, vod)
  })
  handle('series:detail', ({ seriesId }) => {
    const series = getSeriesById(db, seriesId)
    if (!series) throw new Error('Series not found')
    return publicSeries(streamProxy, series)
  })
  handle('vod:subtitles', async ({ vodId }) => {
    const subs = await getVodSubtitles(db, vodId)
    // Proxy each subtitle URL so mpv fetches it via 127.0.0.1 (UA/redirects).
    return { subtitles: subs.map((s) => ({ ...s, url: streamProxy.register(s.url) })) }
  })
  handle('series:episodes', async ({ seriesId }) =>
    (await getEpisodes(db, seriesId)).map((row) => publicEpisode(streamProxy, row))
  )
  handle('episodes:next', ({ episodeId }) => {
    const episode = getEpisodeById(db, episodeId)
    if (!episode) return { nextEpisodeId: null }
    const episodes = listEpisodes(db, episode.seriesId)
    const idx = episodes.findIndex((e) => e.id === episodeId)
    const next = idx >= 0 ? episodes[idx + 1] : undefined
    return { nextEpisodeId: next?.id ?? null }
  })

  handle('stream:url', ({ itemType, itemId, preferredExt }) => {
    const direct = resolveStreamUrl(db, itemType, itemId, preferredExt)
    return {
      url: streamProxy.register(direct.url),
      containerExt: direct.containerExt,
      providerId: direct.providerId
    }
  })

  handle('stream:timeshift', ({ channelId, startSecs, durationMinutes }) => {
    const direct = resolveTimeshiftUrl(db, channelId, startSecs, durationMinutes)
    return {
      url: streamProxy.register(direct.url),
      containerExt: direct.containerExt,
      providerId: direct.providerId
    }
  })

  // --- Profiles -----------------------------------------------------------

  handle('profiles:list', () => listProfiles(db))
  handle('profiles:create', (input) => createProfile(db, input))
  handle('profiles:delete', ({ profileId }) => deleteProfile(db, profileId))
  handle('profiles:verifyPin', ({ profileId, pin }) => ({
    ok: verifyProfilePin(db, profileId, pin)
  }))

  // --- Favorites & history ------------------------------------------------

  handle('favorites:toggle', ({ profileId, itemType, itemId }) => ({
    favorited: toggleFavorite(db, profileId, itemType, itemId)
  }))
  handle('favorites:list', ({ profileId, itemType }) => listFavorites(db, profileId, itemType))
  handle('favorites:detailed', ({ profileId, providerId }) =>
    listFavoritesDetailed(db, profileId, providerId).map((row) => publicFavorite(streamProxy, row))
  )
  handle('history:upsert', (input) => upsertHistory(db, input))
  handle('history:remove', ({ profileId, itemType, itemId }) =>
    removeHistory(db, profileId, itemType, itemId)
  )
  handle('history:position', ({ profileId, itemType, itemId }) =>
    getResumePosition(db, profileId, itemType, itemId)
  )
  handle('history:continueWatching', ({ profileId, limit }) =>
    continueWatching(db, profileId, limit).map((row) => publicContinueWatching(streamProxy, row))
  )

  // --- Native player (mpv) ------------------------------------------------

  const mpvBinary = discoverMpvBinary()
  // Prefer the in-process libmpv addon (macOS): it renders embedded in the app
  // window instead of spawning mpv's own window. Fall back to the spawn+--wid
  // binary path (Windows/Linux embed natively; macOS binary pops out a window).
  const embedded = isEmbeddedMpvAvailable()
  let mpv: MpvController | EmbeddedMpvController | null = null

  // Respect each provider's concurrent-connection cap when opening streams. The
  // native player plays one stream at a time, so we hold at most one slot and
  // release it before opening the next (a zap replaces the stream in place).
  const connectionLimiter = new ConnectionLimiter(
    (providerId) => getProvider(db, providerId)?.maxConnections ?? null
  )
  let heldConnection: ConnectionRelease | null = null
  const releaseConnection = (): void => {
    heldConnection?.()
    heldConnection = null
  }

  // Keep the display awake while a stream is actively playing so the screen
  // doesn't sleep mid-video (nothing feeds the OS idle timer during playback —
  // there's no user input and mpv draws directly). Released on pause/stop so a
  // paused or closed player lets the machine sleep normally.
  let sleepBlockerId: number | null = null
  const preventDisplaySleep = (): void => {
    if (sleepBlockerId === null || !powerSaveBlocker.isStarted(sleepBlockerId)) {
      sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
  }
  const allowDisplaySleep = (): void => {
    if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
      powerSaveBlocker.stop(sleepBlockerId)
    }
    sleepBlockerId = null
  }

  handle('player:capabilities', () => ({
    engine: embedded || mpvBinary ? 'mpv' : 'web',
    embedded
  }))

  handle('player:load', async ({ url, startSecs, live, providerId }) => {
    // Everything playable was minted by stream:url / stream:timeshift and lives
    // on the proxy. Refusing anything else keeps a compromised renderer from
    // handing mpv a file:// path or an arbitrary host to open.
    if (!streamProxy.ownsUrl(url)) throw new Error('Refusing to load a non-proxied URL')
    if (!embedded && !mpvBinary) throw new Error('mpv is not available on this system')
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No window to attach the player to')
    // Reserve a connection slot before opening. Release the previously-held one
    // first: the single native player replaces its current stream rather than
    // opening an additional connection, so a same-provider zap stays within cap.
    // acquire() throws ConnectionLimitError when the provider is already maxed.
    releaseConnection()
    if (providerId !== undefined) heldConnection = connectionLimiter.acquire(providerId)
    if (!mpv) mpv = embedded ? new EmbeddedMpvController() : new MpvController(mpvBinary!)
    try {
      if (!mpv.running) await mpv.start(win)
      await mpv.load(url, { startSecs, live })
      preventDisplaySleep()
    } catch (err) {
      // A wedged/dead controller must not poison later attempts.
      mpv.destroy()
      mpv = null
      allowDisplaySleep()
      releaseConnection()
      throw err
    }
  })

  handle('player:command', async (command) => {
    // Validated before the running check below, so the guard holds regardless
    // of player state: subtitle tracks are proxied by vod:subtitles for the
    // same reason player:load is restricted — mpv must not become an open
    // file reader for a compromised renderer.
    if (command.action === 'addSubtitleFile' && !streamProxy.ownsUrl(command.path)) {
      throw new Error('Refusing to load a non-proxied subtitle')
    }
    // Commands race in while a load is failing/starting — ignore quietly
    // rather than spraying "mpv is not running" errors.
    if (!mpv?.running) return
    switch (command.action) {
      case 'play':
        preventDisplaySleep()
        return mpv.play()
      case 'pause':
        allowDisplaySleep()
        return mpv.pause()
      case 'seek':
        return mpv.seek(command.seconds)
      case 'setVolume':
        return mpv.setVolume(command.volume)
      case 'setAudioTrack':
        return mpv.setAudioTrack(command.trackId)
      case 'setSubtitle':
        return mpv.setSubtitle(command.trackId)
      case 'setSubtitleDelay':
        return mpv.setSubtitleDelay(command.seconds)
      case 'setSubtitleScale':
        return mpv.setSubtitleScale(command.scale)
      case 'addSubtitleFile':
        return mpv.addSubtitleFile(command.path)
      case 'stop':
        allowDisplaySleep()
        return mpv.stop()
    }
  })

  handle('player:stop', () => {
    mpv?.destroy()
    mpv = null
    allowDisplaySleep()
    releaseConnection()
  })

  // --- Window -------------------------------------------------------------

  handle('window:setFullscreen', ({ fullscreen }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    // The renderer learns the resulting state from the `window:fullscreen`
    // event (the macOS transition is animated, so isFullScreen() would be stale
    // if read back here). Owning this centrally keeps the embedded video view
    // and the DOM controls resizing together instead of mpv popping its own FS.
    win?.setFullScreen(fullscreen)
  })

  handle('window:isFullscreen', () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    return win?.isFullScreen() ?? false
  })

  // --- Settings -----------------------------------------------------------

  handle('settings:get', ({ key }) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  })

  handle('settings:set', ({ key, value }) => {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value)
  })
}

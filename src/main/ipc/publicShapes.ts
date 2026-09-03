// The main→renderer boundary for catalog rows.
//
// Domain rows carry two things the renderer must not receive verbatim: the
// provider stream locator (for M3U providers it is the credentialed playlist
// URL) and raw artwork URLs pointing at provider/third-party hosts. Everything
// the renderer reads goes through here, so the stripping can't be forgotten at
// one call site and leak.

import type { StreamProxy } from '@main/services/proxy/streamProxy'
import type { PublicChannel, PublicEpisode, PublicSeries, PublicVodItem } from '@shared/contracts'
import type {
  Channel,
  ContinueWatchingItem,
  Episode,
  FavoriteEntry,
  Page,
  Series,
  VodItem
} from '@shared/types'

export function publicChannel(proxy: StreamProxy, row: Channel): PublicChannel {
  const { streamId: _streamId, ...rest } = row
  return { ...rest, logo: proxy.registerImage(row.logo) }
}

export function publicVod(proxy: StreamProxy, row: VodItem): PublicVodItem {
  const { streamId: _streamId, ...rest } = row
  return { ...rest, cover: proxy.registerImage(row.cover) }
}

export function publicSeries(proxy: StreamProxy, row: Series): PublicSeries {
  const { seriesId: _seriesId, ...rest } = row
  return { ...rest, cover: proxy.registerImage(row.cover) }
}

export function publicEpisode(proxy: StreamProxy, row: Episode): PublicEpisode {
  const { remoteId: _remoteId, ...rest } = row
  return { ...rest, still: proxy.registerImage(row.still) }
}

export function publicFavorite(proxy: StreamProxy, row: FavoriteEntry): FavoriteEntry {
  return { ...row, image: proxy.registerImage(row.image) }
}

export function publicContinueWatching(
  proxy: StreamProxy,
  row: ContinueWatchingItem
): ContinueWatchingItem {
  return { ...row, cover: proxy.registerImage(row.cover) }
}

/** Map a page's items while preserving its cursor. */
export function mapPage<T, U>(page: Page<T>, map: (item: T) => U): Page<U> {
  return { items: page.items.map(map), nextCursor: page.nextCursor }
}

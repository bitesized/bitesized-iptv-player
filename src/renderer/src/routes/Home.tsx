import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '../lib/api'
import { useProviders } from '../lib/queries'
import { useVodPage, useSeriesPage, useRemoveHistory, useToggleFavorite } from '../lib/catalog'
import { useFlatPages, useFavoriteIds } from '../lib/browseHelpers'
import { ContextMenu, useContextMenu } from '../components/ContextMenu'
import type { ContextMenuItem } from '../components/ContextMenu'
import { useUiStore } from '../stores/ui'

function Row({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mb-8">
      <h2 className="mb-3 px-8 text-lg font-semibold text-white">{title}</h2>
      <div className="flex gap-3 overflow-x-auto px-8 pb-2">{children}</div>
    </section>
  )
}

function MiniCard({
  name,
  cover,
  progress,
  menuItems,
  onClick
}: {
  name: string
  cover: string | null
  progress?: number
  menuItems?: ContextMenuItem[]
  onClick: () => void
}): JSX.Element {
  const { menu, onContextMenu, close } = useContextMenu()
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={menuItems && menuItems.length > 0 ? onContextMenu : undefined}
      className="w-32 shrink-0 text-left transition-transform hover:scale-[1.03]"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-raised">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-neutral-600">
            {name}
          </div>
        )}
        {progress !== undefined ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
        ) : null}
      </div>
      <div className="mt-1 truncate text-xs text-neutral-400">{name}</div>
      {menu && menuItems ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={close} items={menuItems} />
      ) : null}
    </button>
  )
}

export function HomeScreen(): JSX.Element {
  const navigate = useNavigate()
  const { data: providers, isLoading } = useProviders()
  const profileId = useUiStore((s) => s.activeProfileId)

  const continueQuery = useQuery({
    queryKey: ['history', 'continue', profileId],
    queryFn: () => invoke('history:continueWatching', { profileId: profileId!, limit: 15 }),
    enabled: profileId !== null
  })
  const recentVod = useFlatPages(useVodPage({ categoryId: 'recent' }))
  const recentSeries = useFlatPages(useSeriesPage({ categoryId: 'recent' }))
  const favoriteVod = useFlatPages(
    useVodPage({ categoryId: 'favorites', profileId: profileId ?? undefined })
  )
  const favoriteSeries = useFlatPages(
    useSeriesPage({ categoryId: 'favorites', profileId: profileId ?? undefined })
  )
  const favoriteVodIds = useFavoriteIds('vod')
  const favoriteSeriesIds = useFavoriteIds('series')
  const toggleFavorite = useToggleFavorite()
  const removeHistory = useRemoveHistory()

  if (!isLoading && providers && providers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold text-white">Welcome</h1>
        <p className="max-w-md text-sm text-neutral-400">
          Connect an Xtream Codes account or import an M3U playlist to start watching. This app
          ships with no content — you supply your own subscription.
        </p>
        <Link
          to="/onboarding"
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Add a provider
        </Link>
      </div>
    )
  }

  const continueItems = continueQuery.data ?? []

  return (
    <div className="py-8">
      {continueItems.length > 0 ? (
        <Row title="Continue watching">
          {continueItems.map((item) => (
            <MiniCard
              key={`${item.itemType}-${item.itemId}`}
              name={
                item.itemType === 'episode' && item.seriesName
                  ? `${item.seriesName} S${item.season ?? '?'}E${item.episodeNum ?? '?'}`
                  : item.name
              }
              cover={item.cover}
              progress={
                item.durationSecs ? Math.min(1, item.positionSecs / item.durationSecs) : undefined
              }
              menuItems={[
                {
                  label: 'Remove from Continue Watching',
                  danger: true,
                  onSelect: () =>
                    removeHistory.mutate({ itemType: item.itemType, itemId: item.itemId })
                }
              ]}
              onClick={() => navigate(`/player/${item.itemType}/${item.itemId}`)}
            />
          ))}
        </Row>
      ) : null}

      {favoriteVod.length > 0 || favoriteSeries.length > 0 ? (
        <Row title="Favorites">
          {favoriteVod.slice(0, 10).map((movie) => (
            <MiniCard
              key={`v${movie.id}`}
              name={movie.name}
              cover={movie.cover}
              menuItems={[
                {
                  label: 'Remove from favorites',
                  danger: true,
                  onSelect: () => toggleFavorite.mutate({ itemType: 'vod', itemId: movie.id })
                }
              ]}
              onClick={() => navigate(`/vod/${movie.id}`)}
            />
          ))}
          {favoriteSeries.slice(0, 10).map((series) => (
            <MiniCard
              key={`s${series.id}`}
              name={series.name}
              cover={series.cover}
              menuItems={[
                {
                  label: 'Remove from favorites',
                  danger: true,
                  onSelect: () => toggleFavorite.mutate({ itemType: 'series', itemId: series.id })
                }
              ]}
              onClick={() => navigate(`/series/${series.id}`)}
            />
          ))}
        </Row>
      ) : null}

      {recentVod.length > 0 ? (
        <Row title="Recently added movies">
          {recentVod.slice(0, 15).map((movie) => (
            <MiniCard
              key={movie.id}
              name={movie.name}
              cover={movie.cover}
              menuItems={[
                {
                  label: favoriteVodIds.has(movie.id)
                    ? 'Remove from favorites'
                    : 'Add to favorites',
                  onSelect: () => toggleFavorite.mutate({ itemType: 'vod', itemId: movie.id })
                }
              ]}
              onClick={() => navigate(`/vod/${movie.id}`)}
            />
          ))}
        </Row>
      ) : null}

      {recentSeries.length > 0 ? (
        <Row title="Recently added series">
          {recentSeries.slice(0, 15).map((series) => (
            <MiniCard
              key={series.id}
              name={series.name}
              cover={series.cover}
              menuItems={[
                {
                  label: favoriteSeriesIds.has(series.id)
                    ? 'Remove from favorites'
                    : 'Add to favorites',
                  onSelect: () => toggleFavorite.mutate({ itemType: 'series', itemId: series.id })
                }
              ]}
              onClick={() => navigate(`/series/${series.id}`)}
            />
          ))}
        </Row>
      ) : null}

      {continueItems.length === 0 && recentVod.length === 0 && recentSeries.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-neutral-500">
          Your catalog is importing or empty — browse Live TV, Movies or Series from the sidebar.
        </div>
      ) : null}
    </div>
  )
}

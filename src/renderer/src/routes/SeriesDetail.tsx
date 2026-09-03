import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { PublicEpisode } from '@shared/contracts'
import { FavoriteButton } from '../components/FavoriteButton'
import { useEpisodes, useSeriesDetail } from '../lib/catalog'
import { useFavoriteIds } from '../lib/browseHelpers'

export function SeriesDetailScreen(): JSX.Element {
  const navigate = useNavigate()
  const { id } = useParams()
  const seriesId = Number(id)
  const { data: series, isLoading } = useSeriesDetail(seriesId)
  const episodesQuery = useEpisodes(seriesId)
  const favoriteIds = useFavoriteIds('series')

  const seasons = useMemo(() => {
    const map = new Map<number, PublicEpisode[]>()
    for (const ep of episodesQuery.data ?? []) {
      const list = map.get(ep.season) ?? []
      list.push(ep)
      map.set(ep.season, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [episodesQuery.data])

  const [activeSeason, setActiveSeason] = useState<number | null>(null)
  const season = activeSeason ?? seasons[0]?.[0] ?? null
  const episodes = seasons.find(([s]) => s === season)?.[1] ?? []

  if (isLoading) return <div className="p-8 text-sm text-neutral-500">Loading…</div>
  if (!series) return <div className="p-8 text-sm text-red-400">Series not found.</div>

  return (
    <div className="mx-auto max-w-4xl p-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-xs text-neutral-500 hover:text-neutral-300"
      >
        ← Back
      </button>
      <div className="flex gap-8">
        <div className="w-48 shrink-0">
          <div className="aspect-[2/3] overflow-hidden rounded-lg bg-surface-raised">
            {series.cover ? (
              <img src={series.cover} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold text-white">{series.name}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-neutral-400">
            {series.rating !== null && series.rating > 0 ? (
              <span className="text-amber-400">★ {series.rating.toFixed(1)}</span>
            ) : null}
            {series.genre ? <span>{series.genre}</span> : null}
            {series.releaseDate ? <span>{series.releaseDate}</span> : null}
            <FavoriteButton
              itemType="series"
              itemId={series.id}
              favorited={favoriteIds.has(series.id)}
            />
          </div>
          {series.plot ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-neutral-300">{series.plot}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-8">
        {episodesQuery.isLoading ? (
          <div className="text-sm text-neutral-500">Loading episodes…</div>
        ) : episodesQuery.error ? (
          <div className="text-sm text-red-400">
            Could not load episodes: {(episodesQuery.error as Error).message}
          </div>
        ) : seasons.length === 0 ? (
          <div className="text-sm text-neutral-500">No episodes listed for this series.</div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1">
              {seasons.map(([s]) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSeason(s)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    s === season
                      ? 'bg-accent/20 text-accent-hover'
                      : 'text-neutral-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  Season {s}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {episodes.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => navigate(`/player/episode/${ep.id}`)}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-white/5"
                >
                  <span className="w-8 shrink-0 text-right text-sm text-neutral-600">
                    {ep.episodeNum}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    {ep.title ?? `Episode ${ep.episodeNum}`}
                  </span>
                  {ep.durationSecs ? (
                    <span className="shrink-0 text-xs text-neutral-600">
                      {Math.round(ep.durationSecs / 60)}m
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

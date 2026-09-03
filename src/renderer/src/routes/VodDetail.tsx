import { useNavigate, useParams } from 'react-router-dom'
import { FavoriteButton } from '../components/FavoriteButton'
import { useVodDetail } from '../lib/catalog'
import { useFavoriteIds } from '../lib/browseHelpers'

function formatDuration(secs: number | null): string | null {
  if (!secs || secs <= 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function VodDetailScreen(): JSX.Element {
  const navigate = useNavigate()
  const { id } = useParams()
  const vodId = Number(id)
  const { data: movie, isLoading, error } = useVodDetail(vodId)
  const favoriteIds = useFavoriteIds('vod')

  if (isLoading) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>
  }
  if (error || !movie) {
    return <div className="p-8 text-sm text-red-400">Movie not found.</div>
  }

  const duration = formatDuration(movie.durationSecs)

  return (
    <div className="mx-auto flex max-w-4xl gap-8 p-8">
      <div className="w-56 shrink-0">
        <div className="aspect-[2/3] overflow-hidden rounded-lg bg-surface-raised">
          {movie.cover ? (
            <img src={movie.cover} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 text-xs text-neutral-500 hover:text-neutral-300"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-semibold text-white">{movie.name}</h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-neutral-400">
          {movie.rating !== null && movie.rating > 0 ? (
            <span className="text-amber-400">★ {movie.rating.toFixed(1)}</span>
          ) : null}
          {duration ? <span>{duration}</span> : null}
          {movie.containerExt ? (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
              {movie.containerExt}
            </span>
          ) : null}
        </div>
        {movie.plot ? (
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-neutral-300">{movie.plot}</p>
        ) : null}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/player/vod/${movie.id}`)}
            className="rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            ▶ Play
          </button>
          <FavoriteButton itemType="vod" itemId={movie.id} favorited={favoriteIds.has(movie.id)} />
        </div>
      </div>
    </div>
  )
}

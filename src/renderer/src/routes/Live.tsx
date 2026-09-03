import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { PublicChannel } from '@shared/contracts'
import type { EpgProgramme } from '@shared/types'
import { effectiveEpgChannelId } from '@shared/epg'
import { invoke } from '../lib/api'
import { CategorySidebar } from '../components/CategorySidebar'
import { FavoriteButton } from '../components/FavoriteButton'
import { ContextMenu, useContextMenu } from '../components/ContextMenu'
import { VirtualRowList } from '../components/VirtualRowList'
import { useCategories, useChannelsPage, useToggleFavorite } from '../lib/catalog'
import { useFavoriteIds, useFlatPages } from '../lib/browseHelpers'
import { useUiStore } from '../stores/ui'

const LIVE_ROW_HEIGHT = 68
/** Channels per `epg:nowNext` request (see the chunking note in LiveScreen). */
const EPG_CHUNK_SIZE = 200

function formatClock(secs: number): string {
  return new Date(secs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Small schedule/guide glyph for the per-row EPG toggle. */
function ScheduleIcon(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  )
}

/** Now-playing title + progress and the next programme, inline on a channel row. */
function NowNext({
  now,
  next
}: {
  now: EpgProgramme | null | undefined
  next: EpgProgramme | null | undefined
}): JSX.Element {
  if (!now && !next) {
    return <span className="truncate text-xs text-neutral-600">No guide data</span>
  }
  const nowTs = Math.floor(Date.now() / 1000)
  const progress = now
    ? Math.min(1, Math.max(0, (nowTs - now.start) / Math.max(1, now.stop - now.start)))
    : 0
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {now ? (
        <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
          <span className="truncate">{now.title}</span>
          <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full bg-accent/70" style={{ width: `${progress * 100}%` }} />
          </span>
        </span>
      ) : null}
      {next ? (
        <span className="truncate text-[11px] text-neutral-600">
          Next {formatClock(next.start)} · {next.title}
        </span>
      ) : null}
    </span>
  )
}

function ChannelRow({
  channel,
  favorited,
  epg,
  scheduleOpen,
  onPlay,
  onToggleSchedule
}: {
  channel: PublicChannel
  favorited: boolean
  epg: { now: EpgProgramme | null; next: EpgProgramme | null } | undefined
  scheduleOpen: boolean
  onPlay: () => void
  onToggleSchedule: () => void
}): JSX.Element {
  const { menu, onContextMenu, close } = useContextMenu()
  const toggleFavorite = useToggleFavorite()
  return (
    <div
      onContextMenu={onContextMenu}
      className="group flex h-full w-full items-center gap-3 border-b border-white/5 px-4 hover:bg-white/5"
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="w-10 shrink-0 text-right text-xs text-neutral-600">
          {channel.num ?? ''}
        </span>
        <span className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-overlay">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="truncate text-sm font-medium text-neutral-200">{channel.name}</span>
          <NowNext now={epg?.now} next={epg?.next} />
        </span>
      </button>
      {channel.tvArchive ? (
        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
          CATCH-UP
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Show schedule"
        aria-pressed={scheduleOpen}
        title="Show schedule"
        onClick={onToggleSchedule}
        className={`shrink-0 rounded-md p-1.5 transition-colors hover:bg-white/10 ${
          scheduleOpen ? 'text-accent-hover' : 'text-neutral-500 hover:text-white'
        }`}
      >
        <ScheduleIcon />
      </button>
      <span className="opacity-0 transition-opacity group-hover:opacity-100">
        <FavoriteButton itemType="live" itemId={channel.id} favorited={favorited} />
      </span>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={[
            {
              label: favorited ? 'Remove from favorites' : 'Add to favorites',
              onSelect: () => toggleFavorite.mutate({ itemType: 'live', itemId: channel.id })
            }
          ]}
        />
      ) : null}
    </div>
  )
}

/** Right-hand pane: one channel's schedule (recent + upcoming) with catch-up. */
function ChannelSchedule({
  channel,
  onClose,
  onPlayLive,
  onPlayCatchUp
}: {
  channel: PublicChannel
  onClose: () => void
  onPlayLive: () => void
  onPlayCatchUp: (programme: EpgProgramme) => void
}): JSX.Element {
  const now = Math.floor(Date.now() / 1000)
  const { data, isLoading } = useQuery({
    queryKey: ['epg', 'schedule', channel.id],
    queryFn: async () => {
      // Ensure the channel's full EPG is present, then read a day-ahead window
      // (with a little history for catch-up).
      await invoke('epg:hydrate', { channelId: channel.id })
      return invoke('epg:window', {
        epgChannelIds: [effectiveEpgChannelId(channel)],
        from: now - 4 * 3600,
        to: now + 24 * 3600
      })
    },
    staleTime: 5 * 60_000
  })

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-white/10 bg-surface-raised">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{channel.name}</div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Schedule</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close schedule"
          className="shrink-0 text-xs text-neutral-500 hover:text-white"
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-xs text-neutral-500">Loading guide…</div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-4 text-xs text-neutral-500">No guide data for this channel.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {data!.map((programme) => {
              const onAir = programme.start <= now && programme.stop > now
              const isPast = programme.stop <= now
              const canCatchUp = channel.tvArchive && isPast
              const clickable = onAir || canCatchUp
              return (
                <li key={programme.id}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => (onAir ? onPlayLive() : onPlayCatchUp(programme))}
                    className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${
                      clickable ? 'hover:bg-white/5' : 'cursor-default'
                    } ${onAir ? 'bg-accent/10' : ''}`}
                  >
                    <span className="w-11 shrink-0 pt-0.5 text-[11px] tabular-nums text-neutral-500">
                      {formatClock(programme.start)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-xs ${
                          isPast && !canCatchUp ? 'text-neutral-600' : 'text-neutral-200'
                        }`}
                      >
                        {programme.title}
                      </span>
                      {programme.description ? (
                        <span className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">
                          {programme.description}
                        </span>
                      ) : null}
                    </span>
                    {onAir ? (
                      <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        Now
                      </span>
                    ) : canCatchUp ? (
                      <span className="shrink-0 pt-0.5 text-[10px] font-semibold uppercase text-accent-hover">
                        Catch-up
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Quick-access strip of favorited live channels above the channel list. */
function FavoritesBar({
  channels,
  onPlay
}: {
  channels: PublicChannel[]
  onPlay: (channelId: number) => void
}): JSX.Element | null {
  if (channels.length === 0) return null
  return (
    // AppShell reserves the top 32px for the WindowDragBar, so the bar clears
    // the drag region (and the traffic lights) without a `no-drag` opt-out.
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-surface px-4 py-2">
      <span className="shrink-0 pr-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        Favorites
      </span>
      {channels.map((channel) => (
        <button
          key={channel.id}
          type="button"
          onClick={() => onPlay(channel.id)}
          title={channel.name}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
        >
          <span className="flex h-6 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-overlay">
            {channel.logo ? (
              <img
                src={channel.logo}
                alt=""
                loading="lazy"
                className="max-h-full max-w-full object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            ) : null}
          </span>
          <span className="max-w-[140px] truncate text-xs font-medium text-neutral-200">
            {channel.name}
          </span>
        </button>
      ))}
    </div>
  )
}

export function LiveScreen(): JSX.Element {
  const navigate = useNavigate()
  const providerId = useUiStore((s) => s.activeProviderId) ?? undefined
  const profileId = useUiStore((s) => s.activeProfileId) ?? undefined
  const category = useUiStore((s) => s.browseCategory.live)
  const setBrowseCategory = useUiStore((s) => s.setBrowseCategory)
  const [scheduleChannel, setScheduleChannel] = useState<PublicChannel | null>(null)

  const { data: categories } = useCategories('live', providerId)
  const query = useChannelsPage({ providerId, categoryId: category, profileId })
  const channels = useFlatPages(query)
  const favoriteIds = useFavoriteIds('live')

  // Favorited live channels (first page) for the quick-access bar. The
  // `favorites` virtual category returns full Channel rows regardless of the
  // browsed category; toggling a favorite invalidates this via ['catalog'].
  const favoriteChannels = useFlatPages(
    useChannelsPage({ providerId, categoryId: 'favorites', profileId })
  )

  // Cached now/next for the channels loaded so far (no provider fetch). Asking
  // in fixed-size chunks keeps a long scroll linear: appending a page only
  // refetches the trailing chunk, where one query keyed on every loaded id
  // re-fetched the whole list each time.
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels])
  const epgChunks = useMemo(() => {
    const chunks: number[][] = []
    for (let i = 0; i < channelIds.length; i += EPG_CHUNK_SIZE) {
      chunks.push(channelIds.slice(i, i + EPG_CHUNK_SIZE))
    }
    return chunks
  }, [channelIds])
  const nowNextQueries = useQueries({
    queries: epgChunks.map((ids) => ({
      queryKey: ['epg', 'nowNext', ids],
      queryFn: () => invoke('epg:nowNext', { channelIds: ids }),
      staleTime: 60_000
    }))
  })
  const epgByChannel = new Map(
    nowNextQueries.flatMap((query) => (query.data ?? []).map((entry) => [entry.channelId, entry]))
  )

  // Launch catch-up for a past programme: the player reads ?ts/&dur and plays
  // the timeshift recording.
  const playCatchUp = (programme: EpgProgramme, channel: PublicChannel): void => {
    const durationMinutes = Math.max(1, Math.round((programme.stop - programme.start) / 60))
    const params = new URLSearchParams({
      ts: String(programme.start),
      dur: String(durationMinutes),
      title: programme.title
    })
    navigate(`/player/live/${channel.id}?${params.toString()}`)
  }

  return (
    <div className="flex h-full">
      <CategorySidebar
        categories={categories}
        selected={category}
        onSelect={(id) => setBrowseCategory('live', id)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <FavoritesBar
          channels={favoriteChannels}
          onPlay={(channelId) => navigate(`/player/live/${channelId}`)}
        />
        {channels.length === 0 && !query.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            No channels here yet.
          </div>
        ) : (
          <VirtualRowList
            items={channels}
            rowHeight={LIVE_ROW_HEIGHT}
            hasMore={query.hasNextPage ?? false}
            onEndReached={() => void query.fetchNextPage()}
            renderRow={(channel) => (
              <ChannelRow
                channel={channel}
                favorited={favoriteIds.has(channel.id)}
                epg={epgByChannel.get(channel.id)}
                scheduleOpen={scheduleChannel?.id === channel.id}
                onPlay={() => navigate(`/player/live/${channel.id}`)}
                onToggleSchedule={() =>
                  setScheduleChannel((cur) => (cur?.id === channel.id ? null : channel))
                }
              />
            )}
          />
        )}
      </div>
      {scheduleChannel ? (
        <ChannelSchedule
          channel={scheduleChannel}
          onClose={() => setScheduleChannel(null)}
          onPlayLive={() => navigate(`/player/live/${scheduleChannel.id}`)}
          onPlayCatchUp={(programme) => playCatchUp(programme, scheduleChannel)}
        />
      ) : null}
    </div>
  )
}

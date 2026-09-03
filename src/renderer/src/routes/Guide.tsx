import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PublicChannel } from '@shared/contracts'
import type { EpgProgramme } from '@shared/types'
import { effectiveEpgChannelId } from '@shared/epg'
import { invoke } from '../lib/api'
import { useChannelsPage } from '../lib/catalog'
import { useFlatPages } from '../lib/browseHelpers'
import { useUiStore } from '../stores/ui'

const PX_PER_HOUR = 280
const ROW_HEIGHT = 52
const HOURS_SHOWN = 12
const CHANNEL_COL_PX = 208

function useGuideWindow(): { start: number; end: number } {
  return useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const start = Math.floor(now / 1800) * 1800 - 1800 // half-slot of history
    return { start, end: start + HOURS_SHOWN * 3600 }
  }, [])
}

function ProgrammeBlocks({
  channel,
  start,
  end,
  onSelect
}: {
  channel: PublicChannel
  start: number
  end: number
  onSelect: (p: EpgProgramme) => void
}): JSX.Element {
  const { data } = useQuery({
    queryKey: ['epg', 'row', channel.id, start],
    queryFn: async () => {
      await invoke('epg:hydrate', { channelId: channel.id })
      return invoke('epg:window', {
        epgChannelIds: [effectiveEpgChannelId(channel)],
        from: start,
        to: end
      })
    },
    staleTime: 10 * 60_000
  })

  const now = Math.floor(Date.now() / 1000)

  return (
    <>
      {(data ?? []).map((programme) => {
        const left = (Math.max(programme.start, start) - start) / 3600
        const right = (Math.min(programme.stop, end) - start) / 3600
        const width = Math.max(0, right - left) * PX_PER_HOUR - 2
        if (width < 4) return null
        const onAir = programme.start <= now && programme.stop > now
        return (
          <button
            key={programme.id}
            type="button"
            onClick={() => onSelect(programme)}
            title={programme.title}
            className={`absolute top-1 overflow-hidden rounded border px-2 text-left text-xs leading-tight ${
              onAir
                ? 'border-accent/40 bg-accent/20 text-white'
                : 'border-white/5 bg-white/[0.04] text-neutral-300 hover:bg-white/10'
            }`}
            style={{
              left: left * PX_PER_HOUR + 1,
              width,
              height: ROW_HEIGHT - 8
            }}
          >
            <span className="line-clamp-2">{programme.title}</span>
          </button>
        )
      })}
    </>
  )
}

export function GuideScreen(): JSX.Element {
  const navigate = useNavigate()
  const providerId = useUiStore((s) => s.activeProviderId) ?? undefined
  const { start, end } = useGuideWindow()
  const [selected, setSelected] = useState<{
    programme: EpgProgramme
    channel: PublicChannel
  } | null>(null)

  // Launch catch-up for a past programme on an archive-capable channel: the
  // player reads ?ts/&dur and plays the timeshift recording.
  const playCatchUp = (programme: EpgProgramme, channel: PublicChannel): void => {
    const durationMinutes = Math.max(1, Math.round((programme.stop - programme.start) / 60))
    const params = new URLSearchParams({
      ts: String(programme.start),
      dur: String(durationMinutes),
      title: programme.title
    })
    navigate(`/player/live/${channel.id}?${params.toString()}`)
  }

  const query = useChannelsPage({ providerId, categoryId: 'all' })
  const channels = useFlatPages(query)

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6
  })
  const virtualRows = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualRows.at(-1)
    if (last && query.hasNextPage && last.index >= channels.length - 10) {
      void query.fetchNextPage()
    }
  }, [virtualRows, channels.length, query])

  // Jump the horizontal scroll to "now" on mount.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = Math.floor(Date.now() / 1000)
    el.scrollLeft = Math.max(0, ((now - start) / 3600) * PX_PER_HOUR - 120)
  }, [start])

  const hours = Array.from({ length: HOURS_SHOWN * 2 }, (_, i) => start + i * 1800)
  const timelineWidth = HOURS_SHOWN * PX_PER_HOUR
  const now = Math.floor(Date.now() / 1000)
  const nowX = ((now - start) / 3600) * PX_PER_HOUR

  if (channels.length === 0 && !query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        Add a provider to see the TV guide.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {selected
        ? (() => {
            const { programme, channel } = selected
            const nowSecs = Math.floor(Date.now() / 1000)
            const onAir = programme.start <= nowSecs && programme.stop > nowSecs
            const isPast = programme.stop <= nowSecs
            const canCatchUp = channel.tvArchive && isPast
            return (
              <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-surface-raised px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{programme.title}</div>
                  <div className="text-xs text-neutral-500">
                    {channel.name} ·{' '}
                    {new Date(programme.start * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {' – '}
                    {new Date(programme.stop * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                  {programme.description ? (
                    <p className="mt-1 line-clamp-3 max-w-2xl text-xs text-neutral-400">
                      {programme.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {onAir ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/player/live/${channel.id}`)}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      Watch live
                    </button>
                  ) : canCatchUp ? (
                    <button
                      type="button"
                      onClick={() => playCatchUp(programme, channel)}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      Watch catch-up
                    </button>
                  ) : isPast ? (
                    <span className="text-xs text-neutral-600">No catch-up</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-xs text-neutral-500 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            )
          })()
        : null}

      <div ref={scrollRef} className="relative flex-1 overflow-auto">
        <div style={{ width: CHANNEL_COL_PX + timelineWidth }}>
          {/* Time header */}
          <div
            className="sticky top-0 z-20 flex border-b border-white/10 bg-surface"
            style={{ height: 28 }}
          >
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-white/10 bg-surface"
              style={{ width: CHANNEL_COL_PX }}
            />
            <div className="relative" style={{ width: timelineWidth }}>
              {hours.map((t, i) => (
                <span
                  key={t}
                  className="absolute top-1 text-[11px] text-neutral-500"
                  style={{ left: i * (PX_PER_HOUR / 2) + 4 }}
                >
                  {new Date(t * 1000).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {/* Now line */}
            {nowX >= 0 && nowX <= timelineWidth ? (
              <div
                className="pointer-events-none absolute top-0 z-10 h-full w-px bg-red-500/80"
                style={{ left: CHANNEL_COL_PX + nowX }}
              />
            ) : null}
            {virtualRows.map((row) => {
              const channel = channels[row.index]!
              return (
                <div
                  key={row.key}
                  className="absolute left-0 flex w-full border-b border-white/5"
                  style={{ transform: `translateY(${row.start}px)`, height: ROW_HEIGHT }}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/player/live/${channel.id}`)}
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-white/10 bg-surface px-3 text-left hover:bg-white/5"
                    style={{ width: CHANNEL_COL_PX }}
                  >
                    <span className="w-8 shrink-0 text-right text-[11px] text-neutral-600">
                      {channel.num ?? ''}
                    </span>
                    <span className="truncate text-xs font-medium text-neutral-200">
                      {channel.name}
                    </span>
                  </button>
                  <div className="relative" style={{ width: timelineWidth }}>
                    <ProgrammeBlocks
                      channel={channel}
                      start={start}
                      end={end}
                      onSelect={(programme) => setSelected({ programme, channel })}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

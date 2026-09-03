import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, invoke } from '../lib/api'
import { WebEngine } from '../player/webEngine'
import { MpvEngineClient } from '../player/mpvEngine'
import type { PlayerEngine, PlayerState, Track } from '../player/engine'
import { CONNECTION_LIMIT_MARKER } from '@shared/player'
import { useUiStore } from '../stores/ui'
import { WindowDragBar } from '../components/WindowDragBar'
import {
  ArrowLeftIcon,
  AudioIcon,
  CheckIcon,
  EnterFullscreenIcon,
  ExitFullscreenIcon,
  FastForwardIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SubtitlesIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon
} from '../player/icons'

type ItemType = 'live' | 'vod' | 'episode'

const MAX_LIVE_RETRIES = 3
// Subtitle adjustment steps and bounds (mpv `sub-delay` / `sub-scale`).
const SUB_DELAY_STEP = 0.1
const SUB_SCALE_STEP = 0.1
// How long the controls (and cursor) linger after the last pointer/keyboard
// activity before fading out — standard streaming-player behaviour.
const CONTROLS_HIDE_MS = 3000

/**
 * If a load error is a connection-limit rejection, return its clean human
 * message (the text after the marker, stripping the IPC handler prefix);
 * otherwise null. These must not fall back to the web engine — that would
 * bypass the cap and open the very connection the provider is refusing.
 */
function connectionLimitMessage(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err)
  const idx = raw.indexOf(CONNECTION_LIMIT_MARKER)
  return idx === -1 ? null : raw.slice(idx + CONNECTION_LIMIT_MARKER.length).trim()
}

function formatTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return h > 0 ? `${h}:${rest}` : rest
}

/** A consistently-styled icon control used across the player chrome. */
function IconButton({
  label,
  onClick,
  active,
  children
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  active?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={`flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-white/10 ${
        active ? 'text-white' : 'text-white/75 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

/** Icon button that opens a popover list of tracks, with the active one ticked. */
function TrackMenuButton({
  label,
  icon,
  tracks,
  allowOff,
  activeId,
  onSelect,
  footer
}: {
  label: string
  icon: JSX.Element
  tracks: Track[]
  allowOff: boolean
  activeId: string | null
  onSelect: (id: string | null) => void
  /** Extra controls pinned below the track list (e.g. subtitle delay/scale). */
  footer?: JSX.Element | null
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Capture-phase containment check (same rationale as ContextMenu): dismiss
    // on any outside pointerdown or Escape without swallowing the item's click.
    const onPointerDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (tracks.length === 0) return null
  const options: { id: string | null; label: string }[] = allowOff
    ? [{ id: null, label: 'Off' }, ...tracks]
    : tracks

  return (
    <div ref={ref} className="relative">
      <IconButton label={label} active={open} onClick={() => setOpen((o) => !o)}>
        {icon}
      </IconButton>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute bottom-full right-0 mb-2 max-h-64 min-w-[200px] overflow-y-auto rounded-xl border border-white/10 bg-surface-overlay/95 p-1 shadow-2xl backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            {label}
          </div>
          {options.map((opt) => {
            const selected = opt.id === activeId
            return (
              <button
                key={opt.id ?? 'off'}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(opt.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-white/10 ${
                  selected ? 'text-white' : 'text-white/70'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {selected ? <CheckIcon size={16} className="shrink-0 text-accent-hover" /> : null}
              </button>
            )
          })}
          {footer ? <div className="mt-1 border-t border-white/10 pt-1">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/** A −/value/+ row; clicking the value resets it to its default. */
function StepperRow({
  label,
  display,
  onDecrement,
  onIncrement,
  onReset
}: {
  label: string
  display: string
  onDecrement: () => void
  onIncrement: () => void
  onReset: () => void
}): JSX.Element {
  const btn =
    'flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-white/80 transition-colors hover:bg-white/10 hover:text-white'
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-sm text-white/70">{label}</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          className={btn}
          onClick={onDecrement}
        >
          −
        </button>
        <button
          type="button"
          aria-label={`Reset ${label}`}
          title="Reset"
          className="w-16 rounded-md py-1 text-center text-sm tabular-nums text-white transition-colors hover:bg-white/10"
          onClick={onReset}
        >
          {display}
        </button>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          className={btn}
          onClick={onIncrement}
        >
          +
        </button>
      </div>
    </div>
  )
}

/** Percentage fill for the accent-filled slider track (see `.player-slider`). */
function fillStyle(fraction: number): React.CSSProperties {
  const pct = `${Math.max(0, Math.min(1, fraction)) * 100}%`
  return { ['--fill' as string]: pct } as React.CSSProperties
}

function VolumeIcon({ volume }: { volume: number }): JSX.Element {
  if (volume === 0) return <VolumeMuteIcon />
  if (volume < 0.5) return <VolumeLowIcon />
  return <VolumeHighIcon />
}

export function PlayerScreen(): JSX.Element {
  const navigate = useNavigate()
  const { itemType, id } = useParams() as { itemType: ItemType; id: string }
  const itemId = Number(id)
  const profileId = useUiStore((s) => s.activeProfileId) ?? 1
  const live = itemType === 'live'

  // Catch-up/timeshift: a live channel replaying a *past* programme, carried on
  // the URL as ?ts=<epoch>&dur=<minutes> (&title). It plays like VOD — finite
  // and scrubbable — so `isLive` (not `live`) gates the live-only behaviours
  // (zap, stall-watchdog, ts↔m3u8 retry, live badge).
  const [searchParams] = useSearchParams()
  const tsStartRaw = searchParams.get('ts')
  const tsDurationRaw = searchParams.get('dur')
  // Memoised so it's stable across renders (loadStream depends on it).
  const timeshift = useMemo(
    () =>
      live && tsStartRaw !== null
        ? { startSecs: Number(tsStartRaw), durationMinutes: Number(tsDurationRaw) || 0 }
        : null,
    [live, tsStartRaw, tsDurationRaw]
  )
  const timeshiftTitle = timeshift ? searchParams.get('title') : null
  const isLive = live && timeshift === null

  const videoRef = useRef<HTMLVideoElement>(null)
  const engineRef = useRef<PlayerEngine | null>(null)
  const positionRef = useRef({ position: 0, duration: null as number | null })
  const progressRef = useRef(Date.now())
  // Playhead value at the last time we credited progress. Compared against the
  // live position to measure *cumulative* advance, not per-sample delta — mpv
  // fires time-pos many times/sec, so consecutive samples move <0.25s and a
  // per-sample check never trips (see the stall watchdog below).
  const progressPosRef = useRef(0)
  const retryRef = useRef({ count: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 })
  // Side-load Xtream VOD subtitles once per stream (adding them re-fires the
  // tracks event, so this guard stops an infinite fetch/add loop).
  const externalSubsAddedRef = useRef(false)
  // Container format for the current live stream (ts vs m3u8). Restored from the
  // last format that worked for this channel, flipped on each retry, and
  // persisted once a format plays.
  const liveFormatRef = useRef<'ts' | 'm3u8'>('ts')
  const liveFormatSavedRef = useRef(false)

  const [engineKind, setEngineKind] = useState<'mpv' | 'web' | null>(null)
  const [embedded, setEmbedded] = useState(false)
  const [state, setState] = useState<PlayerState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
  const [volume, setVolumeState] = useState(1)
  const prevVolumeRef = useRef(1)
  const [audioTracks, setAudioTracks] = useState<Track[]>([])
  const [subtitleTracks, setSubtitleTracks] = useState<Track[]>([])
  const [audioTrackId, setAudioTrackId] = useState<string | null>(null)
  const [subtitleId, setSubtitleId] = useState<string | null>(null)
  // Subtitle timing offset (seconds) resets per stream; font scale is a lasting
  // per-profile preference re-applied to every stream (see effects below).
  const [subtitleDelay, setSubtitleDelay] = useState(0)
  const [subtitleScale, setSubtitleScale] = useState(1)
  const subtitleScaleRef = useRef(1)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read inside the (stable) timer callback without re-creating it: the pointer
  // is over the control bar, or playback is not actively playing — either keeps
  // the controls pinned open.
  const hoveringControls = useRef(false)
  const stateRef = useRef<PlayerState>('loading')

  // Arm the inactivity timer, unless something should keep the controls open
  // (paused/buffering, or the pointer resting on the controls themselves).
  const scheduleHide = useCallback((): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    if (stateRef.current !== 'playing' || hoveringControls.current) return
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS)
  }, [])

  const showControls = useCallback((): void => {
    setControlsVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    void invoke('player:capabilities', undefined).then(({ engine, embedded }) => {
      setEngineKind(engine)
      setEmbedded(embedded)
    })
  }, [])

  // Restore the saved subtitle font scale for this profile (applied to each new
  // stream once its tracks load — see the 'tracks' handler below).
  useEffect(() => {
    subtitleScaleRef.current = subtitleScale
  }, [subtitleScale])

  useEffect(() => {
    void invoke('settings:get', { key: `subtitle.scale:${profileId}` }).then((raw) => {
      const n = raw !== null ? Number(raw) : NaN
      if (Number.isFinite(n) && n > 0) setSubtitleScale(n)
    })
  }, [profileId])

  // Fullscreen is driven through the main process (window:setFullscreen) so the
  // embedded video view and these DOM controls resize together. Track the real
  // state from the push event — that also catches the macOS green button /
  // Ctrl+Cmd+F, which toggle fullscreen without going through our button.
  useEffect(() => {
    void invoke('window:isFullscreen', undefined).then(setIsFullscreen)
    return api.on('window:fullscreen', setIsFullscreen)
  }, [])

  const toggleFullscreen = useCallback((): void => {
    void invoke('window:setFullscreen', { fullscreen: !isFullscreen })
  }, [isFullscreen])

  // Keep control visibility in step with playback: reveal + pin them whenever
  // we're not actively playing (paused/buffering/loading/error), and re-arm the
  // inactivity timer once playback resumes.
  useEffect(() => {
    stateRef.current = state
    if (state === 'playing') scheduleHide()
    else showControls()
  }, [state, scheduleHide, showControls])

  // Clear the pending hide on unmount so it can't fire after teardown.
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), [])

  const loadStream = useCallback(
    async (engine: PlayerEngine): Promise<void> => {
      // `itemType === 'live'` (not `isLive`) so TS narrows itemType to vod|episode.
      const resume =
        itemType === 'live'
          ? null
          : await invoke('history:position', { profileId, itemType, itemId })
      const { url, containerExt, providerId } = timeshift
        ? await invoke('stream:timeshift', {
            channelId: itemId,
            startSecs: timeshift.startSecs,
            durationMinutes: timeshift.durationMinutes
          })
        : await invoke('stream:url', {
            itemType,
            itemId,
            // Live opens with the remembered/current container format.
            ...(isLive ? { preferredExt: liveFormatRef.current } : {})
          })
      await engine.load(url, {
        containerExt,
        // Catch-up is a finite, seekable recording — load it as non-live.
        live: isLive,
        providerId,
        ...(resume !== null ? { startSecs: resume } : {})
      })
    },
    [isLive, timeshift, profileId, itemType, itemId]
  )

  // Engine lifecycle.
  useEffect(() => {
    if (engineKind === null || Number.isNaN(itemId)) return
    const video = videoRef.current
    if (engineKind === 'web' && !video) return

    const engine: PlayerEngine =
      engineKind === 'mpv' ? new MpvEngineClient() : new WebEngine(video!)
    engineRef.current = engine
    retryRef.current = { count: 0, timer: 0 }
    externalSubsAddedRef.current = false
    liveFormatRef.current = 'ts'
    liveFormatSavedRef.current = false
    progressPosRef.current = 0
    // Each new stream (mount, channel zap, next episode) starts from loading so
    // the loading indicator shows and stale 'playing' state from the previous
    // item can't hide the controls before the new file reports its state.
    setState('loading')
    setError(null)
    // New stream: forget the previous item's track menus/selection until the
    // engine reports the new file's tracks.
    setAudioTracks([])
    setSubtitleTracks([])
    setAudioTrackId(null)
    setSubtitleId(null)
    // Subtitle sync is stream-specific — start each new file un-shifted.
    setSubtitleDelay(0)

    const offTime = engine.on('timeupdate', ({ position, duration }) => {
      // Credit progress on cumulative movement since the last mark (playing
      // forward, or a reset/seek), not on the delta between two adjacent
      // samples: time-pos updates arrive faster than 0.25s apart, so a
      // per-sample check would never fire and the watchdog would force-reload a
      // perfectly healthy stream every ~15s.
      if (Math.abs(position - progressPosRef.current) > 0.25) {
        progressRef.current = Date.now()
        progressPosRef.current = position
      }
      positionRef.current = { position, duration }
      setPosition(position)
      setDuration(duration)
    })
    const offState = engine.on('state', ({ state, error }) => {
      setState(state)
      setError(error ?? null)
      // Remember the container format that actually played for this channel, so
      // the next open skips a failing format (persist once per stream).
      if (state === 'playing' && isLive && !liveFormatSavedRef.current) {
        liveFormatSavedRef.current = true
        void invoke('settings:set', {
          key: `live.format:${itemId}`,
          value: liveFormatRef.current
        })
      }
      if (state === 'ended' && !live) {
        // Mark fully watched, then autoplay the next episode when there is one.
        const { duration } = positionRef.current
        if (duration) {
          void invoke('history:upsert', {
            profileId,
            itemType,
            itemId,
            positionSecs: duration,
            durationSecs: duration
          })
        }
        if (itemType === 'episode') {
          void invoke('episodes:next', { episodeId: itemId }).then(({ nextEpisodeId }) => {
            if (nextEpisodeId !== null) {
              navigate(`/player/episode/${nextEpisodeId}`, { replace: true })
            } else {
              navigate(-1)
            }
          })
        }
      }
      // Live streams auto-retry with backoff, flipping ts↔m3u8.
      // Catch-up isn't live — a failure there is surfaced, not hammered.
      if (state === 'error' && isLive && retryRef.current.count < MAX_LIVE_RETRIES) {
        const retry = retryRef.current
        retry.count += 1
        // Flip the container format; the next play persists whichever works.
        liveFormatRef.current = liveFormatRef.current === 'ts' ? 'm3u8' : 'ts'
        liveFormatSavedRef.current = false
        const delay = 1000 * 2 ** retry.count
        setState('buffering')
        retry.timer = setTimeout(() => {
          void loadStream(engine).catch((err: unknown) => {
            setState('error')
            setError(
              connectionLimitMessage(err) ?? (err instanceof Error ? err.message : String(err))
            )
          })
        }, delay)
      }
    })
    const offTracks = engine.on('tracks', ({ audio, subtitles }) => {
      setAudioTracks(audio)
      setSubtitleTracks(subtitles)
      // Reflect mpv's default selection (first audio track, subtitles off) so the
      // menus open showing what's actually playing.
      setAudioTrackId((cur) => cur ?? audio[0]?.id ?? null)
      // Re-apply the saved font scale to this freshly-loaded file.
      if (subtitleScaleRef.current !== 1) engine.setSubtitleScale(subtitleScaleRef.current)
      // Once the file is loaded (tracks known), side-load any external Xtream
      // VOD subtitles; they then appear as selectable tracks. Guarded so the
      // resulting tracks events don't re-trigger the fetch.
      if (itemType === 'vod' && engineKind === 'mpv' && !externalSubsAddedRef.current) {
        externalSubsAddedRef.current = true
        void invoke('vod:subtitles', { vodId: itemId })
          .then(({ subtitles }) => {
            for (const sub of subtitles) engine.addSubtitleFile(sub.url)
          })
          .catch(() => {})
      }
    })

    void (async () => {
      // Live: open with the last container format that worked for this channel.
      if (isLive) {
        const saved = await invoke('settings:get', { key: `live.format:${itemId}` })
        liveFormatRef.current = saved === 'm3u8' ? 'm3u8' : 'ts'
      }
      await loadStream(engine)
    })().catch((err: unknown) => {
      const limit = connectionLimitMessage(err)
      if (limit !== null) {
        // At the provider's connection cap — surface it, don't fall back to web
        // (that path skips the limiter and opens the refused connection).
        setState('error')
        setError(limit)
        return
      }
      if (engineKind === 'mpv') {
        // mpv couldn't start or load — fall back to the web engine rather
        // than dead-ending; the effect reruns and rebuilds the player.
        setEngineKind('web')
        return
      }
      setState('error')
      setError(err instanceof Error ? err.message : String(err))
    })

    showControls()
    return () => {
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer)
      offTime()
      offState()
      offTracks()
      engine.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineKind, itemType, itemId, tsStartRaw, tsDurationRaw])

  // Stall watchdog: a live stream that reports 'playing' but
  // makes no progress for 15s gets force-reloaded.
  useEffect(() => {
    if (!isLive) return
    progressRef.current = Date.now()
    const interval = setInterval(() => {
      const engine = engineRef.current
      if (!engine) return
      const stalled = Date.now() - progressRef.current > 15_000
      if (stalled && (state === 'playing' || state === 'buffering')) {
        progressRef.current = Date.now()
        setState('buffering')
        // A stalled-but-loaded stream reloads the same format (not a fallback).
        void loadStream(engine).catch(() => {})
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [isLive, state, loadStream])

  // Live zap: ↑/↓ move through channels in Live-list order.
  const zap = useCallback(
    (direction: 'prev' | 'next'): void => {
      void invoke('channels:adjacent', { channelId: itemId }).then(({ prevId, nextId }) => {
        const target = direction === 'next' ? nextId : prevId
        if (target !== null) navigate(`/player/live/${target}`, { replace: true })
      })
    },
    [itemId, navigate]
  )

  // Persist watch position every 10s and on unmount (VOD/episodes only).
  useEffect(() => {
    if (live || Number.isNaN(itemId)) return
    const save = (): void => {
      const { position, duration } = positionRef.current
      if (position > 5) {
        void invoke('history:upsert', {
          profileId,
          itemType,
          itemId,
          positionSecs: position,
          durationSecs: duration
        })
      }
    }
    const interval = setInterval(save, 10_000)
    return () => {
      clearInterval(interval)
      save()
    }
  }, [live, itemType, itemId, profileId])

  const togglePlay = useCallback((): void => {
    const engine = engineRef.current
    if (!engine) return
    if (state === 'playing') engine.pause()
    else engine.play()
  }, [state])

  const applyVolume = useCallback((v: number): void => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    engineRef.current?.setVolume(clamped)
  }, [])

  // Volume icon toggles mute, restoring the pre-mute level (min 0.5 if the user
  // had dragged all the way down before muting).
  const toggleMute = useCallback((): void => {
    if (volume > 0) {
      prevVolumeRef.current = volume
      applyVolume(0)
    } else {
      applyVolume(prevVolumeRef.current || 0.5)
    }
  }, [volume, applyVolume])

  const selectAudio = useCallback((id: string | null): void => {
    if (id === null) return
    setAudioTrackId(id)
    engineRef.current?.setAudioTrack(id)
  }, [])

  const selectSubtitle = useCallback((id: string | null): void => {
    setSubtitleId(id)
    engineRef.current?.setSubtitle(id)
  }, [])

  // Subtitle timing offset (seconds, positive = later). Stream-specific, so not
  // persisted; clamped to ±30s.
  const applySubtitleDelay = useCallback((seconds: number): void => {
    const v = Math.round(Math.min(30, Math.max(-30, seconds)) * 10) / 10
    setSubtitleDelay(v)
    engineRef.current?.setSubtitleDelay(v)
  }, [])

  // Subtitle font scale (1 = default). Persisted per profile and re-applied to
  // every stream; clamped to 0.25–4×.
  const applySubtitleScale = useCallback(
    (scale: number): void => {
      const v = Math.round(Math.min(4, Math.max(0.25, scale)) * 100) / 100
      setSubtitleScale(v)
      subtitleScaleRef.current = v
      engineRef.current?.setSubtitleScale(v)
      void invoke('settings:set', { key: `subtitle.scale:${profileId}`, value: String(v) })
    },
    [profileId]
  )

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      showControls()
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'f') {
        toggleFullscreen()
      } else if (e.key === 'Escape') {
        // Escape backs out of fullscreen first (standard player behaviour);
        // only leaves the player when already windowed.
        if (isFullscreen) toggleFullscreen()
        else navigate(-1)
      } else if (!isLive && e.key === 'ArrowRight') {
        engineRef.current?.seek(positionRef.current.position + 15)
      } else if (!isLive && e.key === 'ArrowLeft') {
        engineRef.current?.seek(Math.max(0, positionRef.current.position - 15))
      } else if (isLive && e.key === 'ArrowUp') {
        zap('next')
      } else if (isLive && e.key === 'ArrowDown') {
        zap('prev')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, navigate, isLive, showControls, zap, toggleFullscreen, isFullscreen])

  const playing = state === 'playing'

  return (
    <div
      className={`relative h-screen w-screen ${embedded ? 'bg-transparent' : 'bg-black'} ${
        controlsVisible ? '' : 'cursor-none'
      }`}
      onMouseMove={showControls}
      onClick={togglePlay}
    >
      {/* Draggable top strip + traffic-light clearance; hidden with the controls.
          In fullscreen there are no traffic lights and dragging is inert, so the
          strip is dropped entirely. */}
      {controlsVisible && !isFullscreen ? <WindowDragBar /> : null}
      {engineKind === 'web' || engineKind === null ? (
        <video ref={videoRef} className="h-full w-full" />
      ) : (
        // mpv draws natively into the window behind this transparent surface.
        <div className="h-full w-full" />
      )}

      {/* Top scrim + back button. The container is click-through so the drag
          strip below it still moves the window; only the button takes pointer
          events. On macOS (embedded, windowed) it clears the traffic lights. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-50 bg-gradient-to-b from-black/70 via-black/20 to-transparent px-3 pb-12 pt-2.5 transition-opacity ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          className={`inline-flex ${controlsVisible ? 'pointer-events-auto' : 'pointer-events-none'} ${
            embedded && !isFullscreen ? 'ml-[72px]' : ''
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <IconButton label="Back" onClick={() => navigate(-1)}>
            <ArrowLeftIcon size={22} />
          </IconButton>
          {timeshiftTitle ? (
            <span className="ml-1 flex items-center truncate text-sm font-medium text-white/90">
              {timeshiftTitle}
            </span>
          ) : null}
        </div>
      </div>

      {state === 'loading' || state === 'buffering' ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/15 border-t-accent-hover" />
          <div className="text-sm font-medium tracking-wide text-white/70">
            {state === 'buffering' ? 'Buffering…' : 'Loading…'}
          </div>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-lg font-semibold text-white">Playback failed</div>
          <div className="max-w-md text-sm text-neutral-400">{error}</div>
          {engineKind === 'web' ? (
            <div className="text-xs text-neutral-500">
              The web engine has limited codec support — install mpv for full coverage.
            </div>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              navigate(-1)
            }}
            className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Go back
          </button>
        </div>
      ) : null}

      <div
        data-player-controls
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-4 pt-20 transition-opacity ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => {
          hoveringControls.current = true
          if (hideTimer.current) clearTimeout(hideTimer.current)
          hideTimer.current = null
        }}
        onMouseLeave={() => {
          hoveringControls.current = false
          scheduleHide()
        }}
      >
        {/* Seek bar — shown for VOD/episodes and catch-up (all scrubbable);
            hidden only for true live, which has no fixed timeline. */}
        {!isLive ? (
          <div className="mb-2.5 flex items-center gap-3">
            <span className="w-12 text-right text-xs tabular-nums text-white/60">
              {formatTime(position)}
            </span>
            <input
              type="range"
              min={0}
              max={duration ?? 0}
              step={1}
              value={position}
              disabled={!duration}
              onChange={(e) => engineRef.current?.seek(Number(e.target.value))}
              className="player-slider flex-1"
              style={fillStyle(duration ? position / duration : 0)}
              aria-label="Seek"
            />
            <span className="w-12 text-xs tabular-nums text-white/60">
              {duration ? formatTime(duration) : '--:--'}
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-1">
          <IconButton label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </IconButton>

          {isLive ? (
            <>
              <IconButton label="Previous channel" onClick={() => zap('prev')}>
                <SkipBackIcon size={22} />
              </IconButton>
              <IconButton label="Next channel" onClick={() => zap('next')}>
                <SkipForwardIcon size={22} />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton
                label="Back 15 seconds"
                onClick={() =>
                  engineRef.current?.seek(Math.max(0, positionRef.current.position - 15))
                }
              >
                <RewindIcon size={22} />
              </IconButton>
              <IconButton
                label="Forward 15 seconds"
                onClick={() => engineRef.current?.seek(positionRef.current.position + 15)}
              >
                <FastForwardIcon size={22} />
              </IconButton>
            </>
          )}

          {/* Volume: icon toggles mute, slider reveals on hover/focus. */}
          <div className="group ml-0.5 flex items-center">
            <IconButton label={volume === 0 ? 'Unmute' : 'Mute'} onClick={toggleMute}>
              <VolumeIcon volume={volume} />
            </IconButton>
            <div className="w-0 overflow-hidden transition-[width] duration-200 group-hover:w-24 group-focus-within:w-24">
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                onChange={(e) => applyVolume(Number(e.target.value))}
                className="player-slider w-24"
                style={fillStyle(volume)}
                aria-label="Volume"
              />
            </div>
          </div>

          {isLive ? (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Live
            </span>
          ) : timeshift ? (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              Catch-up
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <TrackMenuButton
              label="Audio"
              icon={<AudioIcon />}
              tracks={audioTracks}
              allowOff={false}
              activeId={audioTrackId}
              onSelect={selectAudio}
            />
            <TrackMenuButton
              label="Subtitles"
              icon={<SubtitlesIcon />}
              tracks={subtitleTracks}
              allowOff
              activeId={subtitleId}
              onSelect={selectSubtitle}
              footer={
                subtitleId !== null ? (
                  <>
                    <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                      Adjust
                    </div>
                    <StepperRow
                      label="Delay"
                      display={`${subtitleDelay > 0 ? '+' : ''}${subtitleDelay.toFixed(1)}s`}
                      onDecrement={() => applySubtitleDelay(subtitleDelay - SUB_DELAY_STEP)}
                      onIncrement={() => applySubtitleDelay(subtitleDelay + SUB_DELAY_STEP)}
                      onReset={() => applySubtitleDelay(0)}
                    />
                    <StepperRow
                      label="Size"
                      display={`${Math.round(subtitleScale * 100)}%`}
                      onDecrement={() => applySubtitleScale(subtitleScale - SUB_SCALE_STEP)}
                      onIncrement={() => applySubtitleScale(subtitleScale + SUB_SCALE_STEP)}
                      onReset={() => applySubtitleScale(1)}
                    />
                  </>
                ) : null
              }
            />
            <IconButton
              label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// Web fallback engine: hls.js for HLS, mpegts.js for MPEG-TS over HTTP, and
// the native <video> element for MP4-family containers. Codec coverage is
// limited by Chromium (no HEVC/AC3 in most builds) — mpv is the production
// engine when it is available.

import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { PlayerEngine, PlayerEventName, PlayerEvents, PlayerState, StreamOpts } from './engine'

type Listener = (payload: never) => void

export class WebEngine implements PlayerEngine {
  private hls: Hls | null = null
  private mpegtsPlayer: mpegts.Player | null = null
  private readonly listeners = new Map<PlayerEventName, Set<Listener>>()
  private readonly domCleanups: (() => void)[] = []

  constructor(private readonly video: HTMLVideoElement) {
    this.bindVideoEvents()
  }

  private emit<E extends PlayerEventName>(event: E, payload: PlayerEvents[E]): void {
    for (const cb of this.listeners.get(event) ?? []) {
      ;(cb as (p: PlayerEvents[E]) => void)(payload)
    }
  }

  private setState(state: PlayerState, error?: string): void {
    this.emit('state', error === undefined ? { state } : { state, error })
  }

  private bindVideoEvents(): void {
    const video = this.video
    const add = (name: string, cb: () => void): void => {
      video.addEventListener(name, cb)
      this.domCleanups.push(() => video.removeEventListener(name, cb))
    }
    add('timeupdate', () =>
      this.emit('timeupdate', {
        position: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : null
      })
    )
    add('playing', () => this.setState('playing'))
    add('pause', () => this.setState('paused'))
    add('ended', () => this.setState('ended'))
    add('waiting', () => this.setState('buffering'))
    add('error', () => {
      const mediaError = video.error
      this.setState('error', mediaError ? `Media error (code ${mediaError.code})` : 'Media error')
    })
  }

  async load(url: string, opts: StreamOpts): Promise<void> {
    this.teardownSources()
    this.setState('loading')

    const isHls = opts.containerExt === 'm3u8' || url.endsWith('.m3u8')
    const isTs = opts.containerExt === 'ts' || url.endsWith('.ts')

    if (isHls && Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) this.setState('error', `HLS error: ${data.details}`)
      })
      this.hls.loadSource(url)
      this.hls.attachMedia(this.video)
    } else if (isTs && mpegts.isSupported()) {
      this.mpegtsPlayer = mpegts.createPlayer({ type: 'mpegts', isLive: opts.live, url })
      this.mpegtsPlayer.on(mpegts.Events.ERROR, (type: string, detail: string) => {
        this.setState('error', `TS error: ${type} ${detail}`)
      })
      this.mpegtsPlayer.attachMediaElement(this.video)
      this.mpegtsPlayer.load()
    } else {
      this.video.src = url
    }

    if (opts.startSecs && !opts.live) {
      const seekOnce = (): void => {
        this.video.currentTime = opts.startSecs ?? 0
        this.video.removeEventListener('loadedmetadata', seekOnce)
      }
      this.video.addEventListener('loadedmetadata', seekOnce)
    }

    try {
      await this.video.play()
    } catch {
      // Autoplay can be rejected before user gesture; controls will start it.
    }
  }

  play(): void {
    void this.video.play()
  }

  pause(): void {
    this.video.pause()
  }

  seek(seconds: number): void {
    this.video.currentTime = seconds
  }

  setAudioTrack(_id: string): void {
    // Chromium exposes almost no audio-track switching for these sources.
  }

  setSubtitle(_id: string | null): void {
    // Text tracks unsupported in the fallback engine; mpv handles this.
  }

  setSubtitleDelay(_seconds: number): void {
    // No subtitle rendering in the fallback engine; mpv handles this.
  }

  setSubtitleScale(_scale: number): void {
    // No subtitle rendering in the fallback engine; mpv handles this.
  }

  addSubtitleFile(_url: string): void {
    // External subtitle side-loading is an mpv feature; no-op here.
  }

  setVolume(volume: number): void {
    this.video.volume = Math.min(1, Math.max(0, volume))
  }

  on<E extends PlayerEventName>(event: E, cb: (payload: PlayerEvents[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb as Listener)
    this.listeners.set(event, set)
    return () => set.delete(cb as Listener)
  }

  private teardownSources(): void {
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
    if (this.mpegtsPlayer) {
      this.mpegtsPlayer.destroy()
      this.mpegtsPlayer = null
    }
    this.video.removeAttribute('src')
  }

  destroy(): void {
    this.teardownSources()
    for (const cleanup of this.domCleanups) cleanup()
    this.listeners.clear()
  }
}

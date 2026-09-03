// Engine-agnostic playback interface. The rest of the app only talks to this;
// WebEngine (hls.js/mpegts.js/native) is the fallback, MpvEngine is the
// production path.

export interface StreamOpts {
  /** Container/protocol hint: 'm3u8', 'ts', 'mp4', 'mkv', … */
  containerExt: string | null
  /** Start position in seconds (resume). */
  startSecs?: number
  live: boolean
  /** Owning provider, so main can reserve a connection slot (mpv path only). */
  providerId?: number
}

export type PlayerState =
  'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

export interface Track {
  id: string
  label: string
  language: string | null
}

export interface PlayerEvents {
  timeupdate: { position: number; duration: number | null }
  state: { state: PlayerState; error?: string }
  tracks: { audio: Track[]; subtitles: Track[] }
}

export type PlayerEventName = keyof PlayerEvents

export interface PlayerEngine {
  load(url: string, opts: StreamOpts): Promise<void>
  play(): void
  pause(): void
  seek(seconds: number): void
  setAudioTrack(id: string): void
  setSubtitle(id: string | null): void
  /** Shift subtitle timing, in seconds (positive = later). mpv only. */
  setSubtitleDelay(seconds: number): void
  /** Subtitle font scale, 1 = default. mpv only. */
  setSubtitleScale(scale: number): void
  /** Side-load an external subtitle file/URL (e.g. Xtream VOD subs). mpv only. */
  addSubtitleFile(url: string): void
  setVolume(volume: number): void
  on<E extends PlayerEventName>(event: E, cb: (payload: PlayerEvents[E]) => void): () => void
  destroy(): void
}

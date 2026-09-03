// Renderer-side PlayerEngine backed by the main-process mpv bridge. Video is
// drawn natively by mpv (embedded via --wid where supported); this class only
// relays commands and events over IPC.

import { api, invoke } from '../lib/api'
import type { PlayerEngine, PlayerEventName, PlayerEvents, StreamOpts, Track } from './engine'

type Listener = (payload: never) => void

export class MpvEngineClient implements PlayerEngine {
  private readonly listeners = new Map<PlayerEventName, Set<Listener>>()
  private readonly offBridge: () => void
  private position = 0
  private duration: number | null = null

  constructor() {
    this.offBridge = api.on('player:event', (event) => {
      switch (event.type) {
        case 'position':
          this.position = event.position
          this.emit('timeupdate', { position: event.position, duration: this.duration })
          break
        case 'duration':
          this.duration = event.duration
          this.emit('timeupdate', { position: this.position, duration: event.duration })
          break
        case 'state':
          this.emit('state', {
            state: event.state === 'idle' ? 'idle' : event.state,
            ...(event.error !== undefined ? { error: event.error } : {})
          })
          break
        case 'tracks': {
          const mapTrack = (t: { id: string; label: string; language: string | null }): Track => ({
            id: t.id,
            label: t.label,
            language: t.language
          })
          this.emit('tracks', {
            audio: event.audio.map(mapTrack),
            subtitles: event.subtitles.map(mapTrack)
          })
          break
        }
        case 'ended':
          this.emit('state', { state: 'ended' })
          break
      }
    })
  }

  private emit<E extends PlayerEventName>(event: E, payload: PlayerEvents[E]): void {
    for (const cb of this.listeners.get(event) ?? []) {
      ;(cb as (p: PlayerEvents[E]) => void)(payload)
    }
  }

  async load(url: string, opts: StreamOpts): Promise<void> {
    this.emit('state', { state: 'loading' })
    await invoke('player:load', {
      url,
      ...(opts.startSecs !== undefined ? { startSecs: opts.startSecs } : {}),
      ...(opts.providerId !== undefined ? { providerId: opts.providerId } : {}),
      live: opts.live
    })
  }

  play(): void {
    void invoke('player:command', { action: 'play' })
  }

  pause(): void {
    void invoke('player:command', { action: 'pause' })
  }

  seek(seconds: number): void {
    void invoke('player:command', { action: 'seek', seconds })
  }

  setAudioTrack(id: string): void {
    void invoke('player:command', { action: 'setAudioTrack', trackId: id })
  }

  setSubtitle(id: string | null): void {
    void invoke('player:command', { action: 'setSubtitle', trackId: id })
  }

  setSubtitleDelay(seconds: number): void {
    void invoke('player:command', { action: 'setSubtitleDelay', seconds })
  }

  setSubtitleScale(scale: number): void {
    void invoke('player:command', { action: 'setSubtitleScale', scale })
  }

  addSubtitleFile(url: string): void {
    void invoke('player:command', { action: 'addSubtitleFile', path: url })
  }

  setVolume(volume: number): void {
    void invoke('player:command', { action: 'setVolume', volume })
  }

  on<E extends PlayerEventName>(event: E, cb: (payload: PlayerEvents[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb as Listener)
    this.listeners.set(event, set)
    return () => set.delete(cb as Listener)
  }

  destroy(): void {
    this.offBridge()
    this.listeners.clear()
    void invoke('player:stop', undefined)
  }
}

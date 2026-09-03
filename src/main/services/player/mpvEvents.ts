// Mapping from mpv protocol events → typed player events. Shared by the
// spawn+socket transport (MpvController) and the in-process libmpv addon
// (EmbeddedMpvController) so both interpret mpv identically.
//
// State derivation is stateful (per playback session): a single mpv property
// change is not enough to name the player state, because "playing", "paused"
// and "buffering" are three independent mpv properties (`pause`,
// `paused-for-cache`) that can be set in any order, and mpv fires an initial
// `pause=no` observation *before* the file is actually loaded. Deriving state
// from the latest value of each (gated on `file-loaded`) fixes two regressions
// from the render-API embed: the buffering spinner staying up
// while playing (because `paused-for-cache: false` emitted nothing to clear it)
// and the loading spinner never showing (because the pre-load `pause=no`
// observation was mapped straight to `playing`).

import type { MpvResponse } from './mpvIpc'
import type { PlayerBridgeState, PlayerEventPayload, PlayerTrack } from '@shared/player'

export function tracksFromList(data: unknown): {
  audio: PlayerTrack[]
  subtitles: PlayerTrack[]
} {
  const audio: PlayerTrack[] = []
  const subtitles: PlayerTrack[] = []
  if (Array.isArray(data)) {
    for (const raw of data) {
      const track = raw as {
        id?: number
        type?: string
        title?: string
        lang?: string
        selected?: boolean
      }
      if (track.id === undefined || !track.type) continue
      const entry: PlayerTrack = {
        id: String(track.id),
        label: track.title ?? track.lang ?? `Track ${track.id}`,
        language: track.lang ?? null,
        selected: track.selected === true
      }
      if (track.type === 'audio') audio.push(entry)
      else if (track.type === 'sub') subtitles.push(entry)
    }
  }
  return { audio, subtitles }
}

/**
 * Translates the mpv event stream for one controller into typed player events.
 * Stateful: create one per controller and `reset()` it before each `load()`.
 */
export class MpvEventTranslator {
  private loaded = false
  private paused = false
  private buffering = false
  private lastState: PlayerBridgeState | null = null

  /** Clear session state before loading a new stream. */
  reset(): void {
    this.loaded = false
    this.paused = false
    this.buffering = false
    this.lastState = null
  }

  /** Zero or more player events for one mpv protocol message. */
  translate(event: MpvResponse): PlayerEventPayload[] {
    const out: PlayerEventPayload[] = []
    if (event.event === 'property-change') {
      switch (event.name) {
        case 'time-pos':
          if (typeof event['data'] === 'number')
            out.push({ type: 'position', position: event['data'] })
          break
        case 'duration':
          out.push({
            type: 'duration',
            duration: typeof event['data'] === 'number' ? event['data'] : null
          })
          break
        case 'pause':
          this.paused = event['data'] === true
          this.pushState(out)
          break
        case 'paused-for-cache':
          this.buffering = event['data'] === true
          this.pushState(out)
          break
        case 'track-list':
          out.push({ type: 'tracks', ...tracksFromList(event['data']) })
          break
        case 'eof-reached':
          if (event['data'] === true) out.push({ type: 'ended' })
          break
      }
    } else if (event.event === 'file-loaded') {
      this.loaded = true
      this.pushState(out)
    } else if (event.event === 'end-file' && event.reason === 'error') {
      this.emitState(out, 'error', 'mpv failed to play the stream')
    }
    return out
  }

  // Derive the player state from the latest pause/cache values. Until the file
  // is loaded we stay in the renderer's default 'loading' state (mpv emits a
  // pre-load `pause=no` observation that must not be read as 'playing').
  private pushState(out: PlayerEventPayload[]): void {
    if (!this.loaded) return
    const state: PlayerBridgeState = this.paused
      ? 'paused'
      : this.buffering
        ? 'buffering'
        : 'playing'
    this.emitState(out, state)
  }

  // Emit a state event only on an actual change, so redundant property
  // notifications don't churn the renderer.
  private emitState(out: PlayerEventPayload[], state: PlayerBridgeState, error?: string): void {
    if (state === this.lastState && error === undefined) return
    this.lastState = state
    out.push(error === undefined ? { type: 'state', state } : { type: 'state', state, error })
  }
}

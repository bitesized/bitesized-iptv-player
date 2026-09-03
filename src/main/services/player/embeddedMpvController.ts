// In-process libmpv playback controller (macOS). Presents the same surface as
// MpvController but, instead of spawning a binary and talking over a socket, it
// drives libmpv inside this process through the native addon and lets libmpv
// render into an NSView embedded in the app window — fixing the macOS
// "player pops out into its own window" bug.

import type { BrowserWindow } from 'electron'
import { loadMpvEmbedAddon } from './mpvEmbedAddon'
import type { MpvEmbedAddon } from './mpvEmbedAddon'
import { loadCommandPlan } from './mpvController'
import { MpvEventTranslator } from './mpvEvents'
import type { MpvResponse } from './mpvIpc'
import type { PlayerEventPayload } from '@shared/player'

const OBSERVED = [
  'time-pos',
  'duration',
  'pause',
  'paused-for-cache',
  'track-list',
  'eof-reached'
] as const

/** All arguments cross the addon boundary as strings; mpv coerces them. */
function mpvArg(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function isEmbeddedMpvAvailable(): boolean {
  return loadMpvEmbedAddon() !== null
}

/**
 * Re-pin the embedded video view below the web layer. Called after a fullscreen
 * transition: macOS can reorder the
 * contentView's subviews across the transition, and the web contents must stay
 * on top so the DOM controls remain visible/clickable. A no-op when the addon
 * is unavailable or nothing is embedded (the native side guards on the view).
 */
export function reassertEmbedZOrder(): void {
  try {
    loadMpvEmbedAddon()?.reassertZOrder()
  } catch {
    // Best-effort; never let a z-order tweak break a fullscreen transition.
  }
}

export class EmbeddedMpvController {
  private addon: MpvEmbedAddon | null = null
  private window: BrowserWindow | null = null
  private started = false
  private readonly translator = new MpvEventTranslator()

  get running(): boolean {
    return this.started && this.addon !== null
  }

  private emit(payload: PlayerEventPayload): void {
    const win = this.window
    if (win && !win.isDestroyed()) win.webContents.send('player:event', payload)
  }

  async start(win: BrowserWindow): Promise<void> {
    if (this.running) return
    const addon = loadMpvEmbedAddon()
    if (!addon) throw new Error('mpv embed addon is not available')
    this.window = win
    this.addon = addon
    addon.create(win.getNativeWindowHandle(), (json) => this.onSink(json))
    OBSERVED.forEach((name, i) => {
      try {
        addon.observe(i + 1, name)
      } catch {
        // Property availability varies across mpv builds; ignore.
      }
    })
    this.started = true
  }

  private onSink(json: string): void {
    let message: MpvResponse
    try {
      message = JSON.parse(json) as MpvResponse
    } catch {
      return
    }
    for (const payload of this.translator.translate(message)) this.emit(payload)
  }

  async load(url: string, opts: { startSecs?: number; live: boolean }): Promise<void> {
    const addon = this.requireAddon()
    this.translator.reset()
    for (const step of loadCommandPlan(url, opts)) {
      try {
        // `set_property` is a JSON-IPC pseudo-command that the C `mpv_command`
        // API rejects ("invalid parameter"); property writes must go through
        // mpv_set_property_string. The socket transport speaks JSON IPC, so its
        // loadCommandPlan uses set_property directly — here we translate.
        const [cmd, name, value] = step.args
        if (cmd === 'set_property') {
          addon.setProperty(String(name), mpvArg(value))
        } else {
          addon.command(step.args.map(mpvArg))
        }
      } catch (err) {
        if (!step.optional) throw err
      }
    }
  }

  async play(): Promise<void> {
    this.requireAddon().setProperty('pause', 'no')
  }

  async pause(): Promise<void> {
    this.requireAddon().setProperty('pause', 'yes')
  }

  async seek(seconds: number): Promise<void> {
    this.requireAddon().command(['seek', String(seconds), 'absolute'])
  }

  async setVolume(volume: number): Promise<void> {
    this.requireAddon().setProperty('volume', String(Math.round(volume * 100)))
  }

  async setAudioTrack(id: string): Promise<void> {
    this.requireAddon().setProperty('aid', id)
  }

  async setSubtitle(id: string | null): Promise<void> {
    this.requireAddon().setProperty('sid', id === null ? 'no' : id)
  }

  async setSubtitleDelay(seconds: number): Promise<void> {
    this.requireAddon().setProperty('sub-delay', String(seconds))
  }

  async setSubtitleScale(scale: number): Promise<void> {
    this.requireAddon().setProperty('sub-scale', String(scale))
  }

  async addSubtitleFile(path: string): Promise<void> {
    this.requireAddon().command(['sub-add', path, 'select'])
  }

  async stop(): Promise<void> {
    this.requireAddon().command(['stop'])
  }

  destroy(): void {
    // Idempotent: once torn down there is nothing to release, and we must not
    // touch the (possibly closing) window again.
    if (!this.addon && !this.started) return
    try {
      // addon.destroy() returns immediately — mpv teardown runs off the main
      // thread inside the addon, so this never blocks.
      this.addon?.destroy()
    } catch {
      // Best-effort teardown.
    }
    this.addon = null
    this.started = false
    this.emit({ type: 'state', state: 'idle' })
    this.window = null
  }

  private requireAddon(): MpvEmbedAddon {
    if (!this.addon) throw new Error('mpv embed is not running')
    return this.addon
  }
}

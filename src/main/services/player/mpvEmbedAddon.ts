// Loader for the in-process libmpv embedding addon (macOS only). The addon is
// a native .node compiled out-of-tree under native/mpv-embed; we load it by
// absolute path via a runtime require so the bundler leaves it external. If it
// is missing (unbuilt, or a non-darwin platform) we return null and the caller
// falls back to the spawn+--wid path.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface MpvEmbedAddon {
  apiVersion(): number
  /** Create + initialize libmpv, embedding a video view in the window. */
  create(nativeWindowHandle: Buffer, sink: (json: string) => void): void
  /** Run an mpv command (all args as strings). */
  command(args: string[]): void
  /** Set a property (value as a string; mpv coerces). */
  setProperty(name: string, value: string): void
  /** Observe a property, delivered to the sink as a property-change event. */
  observe(id: number, name: string): void
  /** Reposition the video view (device-independent points, view coords). */
  setBounds(x: number, y: number, width: number, height: number): void
  /** Re-pin the video view below the web layer (after a fullscreen transition). */
  reassertZOrder(): void
  destroy(): void
}

// A require detached from the bundle graph so the bundler doesn't try to
// resolve the .node at build time. We only ever call it with absolute paths, so
// the resolution base (the Electron binary) is irrelevant.
const runtimeRequire = createRequire(process.execPath)

let cached: MpvEmbedAddon | null | undefined

export function loadMpvEmbedAddon(): MpvEmbedAddon | null {
  if (cached !== undefined) return cached
  if (process.platform !== 'darwin') {
    cached = null
    return null
  }
  const candidates = [
    process.env['MPV_EMBED_ADDON'],
    join(app.getAppPath(), 'native', 'mpv-embed', 'build', 'Release', 'mpv_embed.node'),
    join(process.resourcesPath ?? '', 'mpv-embed', 'mpv_embed.node')
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      try {
        cached = runtimeRequire(candidate) as MpvEmbedAddon
        return cached
      } catch {
        // Try the next candidate (ABI mismatch, missing libmpv, etc.).
      }
    }
  }
  cached = null
  return null
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MpvEmbedAddon } from '@main/services/player/mpvEmbedAddon'

// Never load the real native addon in unit tests: mock the loader and swap what
// it returns per-test (null = addon unavailable → spawn fallback).
let fakeAddon: MpvEmbedAddon | null = null
vi.mock('@main/services/player/mpvEmbedAddon', () => ({
  loadMpvEmbedAddon: () => fakeAddon
}))

import {
  EmbeddedMpvController,
  isEmbeddedMpvAvailable
} from '@main/services/player/embeddedMpvController'

function spyAddon(): MpvEmbedAddon & {
  calls: { command: string[][]; setProperty: [string, string][] }
} {
  const calls = { command: [] as string[][], setProperty: [] as [string, string][] }
  return {
    calls,
    apiVersion: () => 0,
    create: vi.fn(),
    observe: vi.fn(),
    setBounds: vi.fn(),
    reassertZOrder: vi.fn(),
    destroy: vi.fn(),
    command: (args: string[]) => calls.command.push(args),
    setProperty: (name: string, value: string) => calls.setProperty.push([name, value])
  }
}

function fakeWindow(): Parameters<EmbeddedMpvController['start']>[0] {
  return {
    getNativeWindowHandle: () => Buffer.alloc(8),
    isDestroyed: () => false,
    webContents: { send: () => {} }
  } as unknown as Parameters<EmbeddedMpvController['start']>[0]
}

afterEach(() => {
  fakeAddon = null
})

describe('EmbeddedMpvController (addon unavailable)', () => {
  it('reports embedding unavailable when the addon does not load', () => {
    expect(isEmbeddedMpvAvailable()).toBe(false)
  })

  it('start rejects clearly when the addon is unavailable', async () => {
    await expect(new EmbeddedMpvController().start(fakeWindow())).rejects.toThrow(/not available/)
  })

  it('driving before start throws rather than silently no-oping', async () => {
    const controller = new EmbeddedMpvController()
    await expect(controller.play()).rejects.toThrow(/not running/)
    await expect(controller.load('http://x/s.ts', { live: true })).rejects.toThrow(/not running/)
  })
})

describe('EmbeddedMpvController load (addon present)', () => {
  it('routes set_property steps to setProperty, not the C command API', async () => {
    // Regression: `set_property` is a JSON-IPC pseudo-command that mpv_command
    // rejects ("invalid parameter"). load() must translate those to
    // mpv_set_property_string while real input commands (loadfile) go through
    // command().
    const addon = spyAddon()
    fakeAddon = addon
    const controller = new EmbeddedMpvController()
    await controller.start(fakeWindow())

    await controller.load('http://127.0.0.1:9/s/live.ts', { live: true })

    // loadfile is the only real input command sent.
    expect(addon.calls.command).toEqual([['loadfile', 'http://127.0.0.1:9/s/live.ts', 'replace']])
    // start (cleared for live) and pause both go through setProperty.
    expect(addon.calls.setProperty).toContainEqual(['start', 'none'])
    expect(addon.calls.setProperty).toContainEqual(['pause', 'no'])
    // No set_property ever leaks into the command API.
    expect(addon.calls.command.some((c) => c[0] === 'set_property')).toBe(false)
  })

  it('sets a numeric resume point for VOD via setProperty', async () => {
    const addon = spyAddon()
    fakeAddon = addon
    const controller = new EmbeddedMpvController()
    await controller.start(fakeWindow())

    await controller.load('http://x/movie.mkv', { live: false, startSecs: 92.7 })

    expect(addon.calls.setProperty).toContainEqual(['start', '+92'])
    expect(addon.calls.command).toEqual([['loadfile', 'http://x/movie.mkv', 'replace']])
  })
})

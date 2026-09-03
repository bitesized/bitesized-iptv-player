// Behavioural test for the player's auto-hiding controls: they should reveal on
// pointer/keyboard activity and fade (with the cursor) after a short idle, but
// stay pinned while paused or while the pointer rests on the control bar —
// standard streaming-player behaviour.
//
// The web engine maps the <video> element's `playing`/`pause` events to player
// state, so we drive real state transitions by firing those DOM events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { emitEvent, mockChannel, resetMockApi } from './mockApi'
import { PlayerScreen } from '@renderer/routes/Player'
import { useUiStore } from '@renderer/stores/ui'
import type { PlayerCommand } from '@shared/player'

const HIDE_MS = 3000

function renderPlayer(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  const router = createMemoryRouter(
    [{ path: '/player/:itemType/:id', element: <PlayerScreen /> }],
    { initialEntries: ['/player/vod/1'] }
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

// Flush the mount promises (capabilities → engine → loadStream) under fake timers.
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function controlBar(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-player-controls]')
  if (!el) throw new Error('control bar not found')
  return el as HTMLElement
}

function root(container: HTMLElement): HTMLElement {
  return container.firstChild as HTMLElement
}

beforeEach(() => {
  resetMockApi()
  useUiStore.setState({ activeProfileId: 1, activeProviderId: null })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('player controls auto-hide', () => {
  it('fades the controls and cursor after inactivity once playing', async () => {
    const { container } = renderPlayer()
    await settle()

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video).toBeTruthy()

    // Reach the playing state, then let the idle timer elapse.
    await act(async () => {
      fireEvent.playing(video)
    })
    expect(controlBar(container).className).toContain('opacity-100')

    await advance(HIDE_MS)
    expect(controlBar(container).className).toContain('opacity-0')
    expect(root(container).className).toContain('cursor-none')
  })

  it('re-reveals controls on mouse movement', async () => {
    const { container } = renderPlayer()
    await settle()
    const video = container.querySelector('video') as HTMLVideoElement

    await act(async () => {
      fireEvent.playing(video)
    })
    await advance(HIDE_MS)
    expect(controlBar(container).className).toContain('opacity-0')

    await act(async () => {
      fireEvent.mouseMove(root(container))
    })
    expect(controlBar(container).className).toContain('opacity-100')
    expect(root(container).className).not.toContain('cursor-none')
  })

  it('keeps controls pinned while paused', async () => {
    const { container } = renderPlayer()
    await settle()
    const video = container.querySelector('video') as HTMLVideoElement

    await act(async () => {
      fireEvent.playing(video)
    })
    await act(async () => {
      fireEvent.pause(video)
    })

    // Well past the idle window — paused playback must not hide the controls.
    await advance(HIDE_MS * 2)
    expect(controlBar(container).className).toContain('opacity-100')
    expect(root(container).className).not.toContain('cursor-none')
  })

  it('does not hide while the pointer rests on the control bar', async () => {
    const { container } = renderPlayer()
    await settle()
    const video = container.querySelector('video') as HTMLVideoElement

    await act(async () => {
      fireEvent.playing(video)
    })
    await act(async () => {
      fireEvent.mouseEnter(controlBar(container))
    })

    await advance(HIDE_MS * 2)
    expect(controlBar(container).className).toContain('opacity-100')
  })
})

// The player owns fullscreen (drives the Electron window rather than letting mpv
// pop its own), so the embedded video and DOM controls stay in step.
describe('player fullscreen', () => {
  it('requests window fullscreen from the toggle button', async () => {
    const calls: boolean[] = []
    mockChannel('window:setFullscreen', ({ fullscreen }) => {
      calls.push(fullscreen)
    })
    const { getByLabelText } = renderPlayer()
    await settle()

    await act(async () => {
      fireEvent.click(getByLabelText('Enter fullscreen'))
    })
    expect(calls).toEqual([true])
  })

  it('requests fullscreen when the f key is pressed', async () => {
    const calls: boolean[] = []
    mockChannel('window:setFullscreen', ({ fullscreen }) => {
      calls.push(fullscreen)
    })
    renderPlayer()
    await settle()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'f' })
    })
    expect(calls).toEqual([true])
  })

  it('tracks OS-initiated fullscreen changes and drops the drag strip', async () => {
    const { container, getByLabelText } = renderPlayer()
    await settle()

    // A drag strip is present while windowed.
    expect(container.querySelector('.z-40')).toBeTruthy()

    // The window enters fullscreen without going through our button (green
    // button / Ctrl+Cmd+F): the push event flips the UI.
    await act(async () => {
      emitEvent('window:fullscreen', true)
    })
    expect(getByLabelText('Exit fullscreen')).toBeTruthy()
    expect(container.querySelector('.z-40')).toBeNull()
  })

  it('exits fullscreen on Escape instead of leaving the player', async () => {
    const calls: boolean[] = []
    mockChannel('window:setFullscreen', ({ fullscreen }) => {
      calls.push(fullscreen)
    })
    renderPlayer()
    await settle()

    await act(async () => {
      emitEvent('window:fullscreen', true)
    })
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    // Escape asked to leave fullscreen (fullscreen:false), not navigate away.
    expect(calls).toEqual([false])
  })
})

// Catch-up/timeshift: a live channel replaying a past programme resolves via
// stream:timeshift, plays as a scrubbable (non-live) stream, and shows a
// Catch-up badge.
describe('catch-up / timeshift playback', () => {
  function renderTimeshiftPlayer(): ReturnType<typeof render> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    const router = createMemoryRouter(
      [{ path: '/player/:itemType/:id', element: <PlayerScreen /> }],
      { initialEntries: ['/player/live/5?ts=1700000000&dur=30&title=Evening%20News'] }
    )
    return render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  }

  it('resolves the timeshift URL (not the live URL) and shows catch-up chrome', async () => {
    const tsCalls: { channelId: number; startSecs: number; durationMinutes: number }[] = []
    mockChannel('stream:timeshift', (req) => {
      tsCalls.push(req)
      return { url: 'http://127.0.0.1:1/ts.ts', containerExt: 'ts', providerId: 1 }
    })
    let liveResolved = false
    mockChannel('stream:url', () => {
      liveResolved = true
      return { url: 'http://127.0.0.1:1/live.ts', containerExt: 'ts', providerId: 1 }
    })

    const ui = renderTimeshiftPlayer()
    await settle()

    expect(tsCalls).toEqual([{ channelId: 5, startSecs: 1700000000, durationMinutes: 30 }])
    expect(liveResolved).toBe(false)
    // Catch-up chrome: the badge, the programme title, and a scrub bar (which
    // true live never shows).
    expect(ui.getByText('Catch-up')).toBeTruthy()
    expect(ui.getByText('Evening News')).toBeTruthy()
    expect(ui.getByLabelText('Seek')).toBeTruthy()
  })
})

// Live streams remember the container format (ts vs m3u8) that last worked for
// a channel.
describe('live container format memory', () => {
  function renderLivePlayer(): ReturnType<typeof render> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    const router = createMemoryRouter(
      [{ path: '/player/:itemType/:id', element: <PlayerScreen /> }],
      { initialEntries: ['/player/live/5'] }
    )
    return render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  }

  it('opens live with the remembered format', async () => {
    mockChannel('player:capabilities', () => ({ engine: 'mpv', embedded: false }))
    mockChannel('settings:get', ({ key }) => (key === 'live.format:5' ? 'm3u8' : null))
    const reqs: (string | undefined)[] = []
    mockChannel('stream:url', (req) => {
      reqs.push(req.preferredExt)
      return { url: 'http://127.0.0.1:1/s.m3u8', containerExt: 'm3u8', providerId: 1 }
    })

    const ui = renderLivePlayer()
    await settle()
    await settle()
    expect(reqs).toContain('m3u8')
    ui.unmount()
  })

  it('persists the format that plays', async () => {
    mockChannel('player:capabilities', () => ({ engine: 'mpv', embedded: false }))
    mockChannel('settings:get', () => null) // no memory yet → defaults to ts
    const saves: { key: string; value: string }[] = []
    mockChannel('settings:set', (req) => {
      saves.push(req)
    })

    const ui = renderLivePlayer()
    await settle()
    await settle()
    await act(async () => {
      emitEvent('player:event', { type: 'state', state: 'playing' })
    })
    expect(saves).toContainEqual({ key: 'live.format:5', value: 'ts' })
    ui.unmount()
  })
})

// Subtitle delay/scale controls surface inside the Subtitles menu once a track
// is selected, drive mpv via player:command, and persist scale per profile.
// Uses the mpv engine because the web fallback has no subtitle support.
describe('subtitle delay/scale controls', () => {
  async function setupWithSubtitle(): Promise<{
    commands: PlayerCommand[]
    scaleSaves: string[]
    ui: ReturnType<typeof renderPlayer>
  }> {
    mockChannel('player:capabilities', () => ({ engine: 'mpv', embedded: false }))
    const commands: PlayerCommand[] = []
    mockChannel('player:command', (c) => {
      commands.push(c)
    })
    const scaleSaves: string[] = []
    mockChannel('settings:set', ({ key, value }) => {
      if (key === 'subtitle.scale:1') scaleSaves.push(value)
    })
    const ui = renderPlayer()
    await settle()
    // mpv reports one subtitle track; select it so the adjust controls appear.
    await act(async () => {
      emitEvent('player:event', {
        type: 'tracks',
        audio: [],
        subtitles: [{ id: '1', label: 'English', language: 'eng', selected: false }]
      })
    })
    await act(async () => {
      fireEvent.click(ui.getByLabelText('Subtitles'))
    })
    await act(async () => {
      fireEvent.click(ui.getByRole('menuitemradio', { name: 'English' }))
    })
    // Reopen the menu — the delay/scale steppers show only with a track active.
    await act(async () => {
      fireEvent.click(ui.getByLabelText('Subtitles'))
    })
    return { commands, scaleSaves, ui }
  }

  it('nudges subtitle delay through mpv', async () => {
    const { commands, ui } = await setupWithSubtitle()
    await act(async () => {
      fireEvent.click(ui.getByLabelText('Increase Delay'))
    })
    expect(commands).toContainEqual({ action: 'setSubtitleDelay', seconds: 0.1 })
  })

  it('changes subtitle size and persists it per profile', async () => {
    const { commands, scaleSaves, ui } = await setupWithSubtitle()
    await act(async () => {
      fireEvent.click(ui.getByLabelText('Increase Size'))
    })
    expect(commands).toContainEqual({ action: 'setSubtitleScale', scale: 1.1 })
    expect(scaleSaves).toContain('1.1')
  })

  it('side-loads external Xtream VOD subtitles once the file loads', async () => {
    mockChannel('player:capabilities', () => ({ engine: 'mpv', embedded: false }))
    mockChannel('vod:subtitles', () => ({
      subtitles: [{ url: 'http://127.0.0.1:1/sub/en.srt', label: 'English', language: 'en' }]
    }))
    const commands: PlayerCommand[] = []
    mockChannel('player:command', (c) => {
      commands.push(c)
    })
    const ui = renderPlayer() // default route is /player/vod/1
    await settle()
    await act(async () => {
      emitEvent('player:event', { type: 'tracks', audio: [], subtitles: [] })
    })
    // Flush the vod:subtitles fetch + its chained addSubtitleFile.
    await settle()
    await settle()
    expect(commands).toContainEqual({
      action: 'addSubtitleFile',
      path: 'http://127.0.0.1:1/sub/en.srt'
    })
    ui.unmount()
  })

  it('restores the saved subtitle scale and applies it to the stream', async () => {
    mockChannel('player:capabilities', () => ({ engine: 'mpv', embedded: false }))
    mockChannel('settings:get', ({ key }) => (key === 'subtitle.scale:1' ? '1.5' : null))
    const commands: PlayerCommand[] = []
    mockChannel('player:command', (c) => {
      commands.push(c)
    })
    const ui = renderPlayer()
    await settle()
    await act(async () => {
      emitEvent('player:event', {
        type: 'tracks',
        audio: [],
        subtitles: [{ id: '1', label: 'English', language: 'eng', selected: false }]
      })
    })
    // The saved 1.5× scale is pushed to mpv when the file's tracks load.
    expect(commands).toContainEqual({ action: 'setSubtitleScale', scale: 1.5 })
    ui.unmount()
  })
})

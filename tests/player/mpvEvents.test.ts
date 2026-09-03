import { describe, expect, it } from 'vitest'
import { MpvEventTranslator, tracksFromList } from '@main/services/player/mpvEvents'

// Drive a translator through a `file-loaded` first so state events are emitted
// (before load the renderer stays in its default 'loading' state).
function loaded(): MpvEventTranslator {
  const t = new MpvEventTranslator()
  t.reset()
  t.translate({ event: 'file-loaded' })
  return t
}

describe('MpvEventTranslator', () => {
  it('maps position and duration property changes', () => {
    const t = loaded()
    expect(t.translate({ event: 'property-change', name: 'time-pos', data: 12.5 })).toEqual([
      { type: 'position', position: 12.5 }
    ])
    expect(t.translate({ event: 'property-change', name: 'duration', data: 3600 })).toEqual([
      { type: 'duration', duration: 3600 }
    ])
  })

  it('stays in loading (no state) until the file is loaded', () => {
    const t = new MpvEventTranslator()
    t.reset()
    // mpv fires an initial pause=no observation before playback begins; it must
    // not be reported as 'playing' or the loading spinner never shows.
    expect(t.translate({ event: 'property-change', name: 'pause', data: false })).toEqual([])
    expect(t.translate({ event: 'property-change', name: 'paused-for-cache', data: true })).toEqual(
      []
    )
    // file-loaded flushes the current derived state (buffering, since cache is
    // still pausing).
    expect(t.translate({ event: 'file-loaded' })).toEqual([{ type: 'state', state: 'buffering' }])
  })

  it('file-loaded → playing, then pause toggles paused/playing', () => {
    const t = new MpvEventTranslator()
    t.reset()
    expect(t.translate({ event: 'file-loaded' })).toEqual([{ type: 'state', state: 'playing' }])
    expect(t.translate({ event: 'property-change', name: 'pause', data: true })).toEqual([
      { type: 'state', state: 'paused' }
    ])
    expect(t.translate({ event: 'property-change', name: 'pause', data: false })).toEqual([
      { type: 'state', state: 'playing' }
    ])
  })

  it('clears buffering when paused-for-cache goes false (regression 7.5 #5b)', () => {
    const t = loaded()
    expect(t.translate({ event: 'property-change', name: 'paused-for-cache', data: true })).toEqual(
      [{ type: 'state', state: 'buffering' }]
    )
    // The fix: false must return to playing, not leave the spinner stuck up.
    expect(
      t.translate({ event: 'property-change', name: 'paused-for-cache', data: false })
    ).toEqual([{ type: 'state', state: 'playing' }])
  })

  it('keeps paused while a cache event comes and goes', () => {
    const t = loaded()
    t.translate({ event: 'property-change', name: 'pause', data: true })
    // A cache pause while user-paused shouldn't flip us to buffering/playing.
    expect(t.translate({ event: 'property-change', name: 'paused-for-cache', data: true })).toEqual(
      []
    )
    expect(
      t.translate({ event: 'property-change', name: 'paused-for-cache', data: false })
    ).toEqual([])
  })

  it('does not re-emit an unchanged state', () => {
    const t = loaded() // already 'playing'
    expect(t.translate({ event: 'property-change', name: 'pause', data: false })).toEqual([])
  })

  it('maps eof-reached → ended and an error end-file → error', () => {
    const t = loaded()
    expect(t.translate({ event: 'property-change', name: 'eof-reached', data: true })).toEqual([
      { type: 'ended' }
    ])
    expect(t.translate({ event: 'end-file', reason: 'error' })).toEqual([
      { type: 'state', state: 'error', error: 'mpv failed to play the stream' }
    ])
    // A non-error end-file (eof/stop) produces no error event.
    expect(t.translate({ event: 'end-file', reason: 'eof' })).toEqual([])
  })

  it('splits a track-list into audio and subtitle tracks', () => {
    const t = loaded()
    const [event] = t.translate({
      event: 'property-change',
      name: 'track-list',
      data: [
        { id: 1, type: 'audio', lang: 'en', selected: true },
        { id: 2, type: 'audio', title: 'Commentary', lang: 'en' },
        { id: 3, type: 'sub', lang: 'fr' }
      ]
    })
    expect(event).toEqual({
      type: 'tracks',
      audio: [
        { id: '1', label: 'en', language: 'en', selected: true },
        { id: '2', label: 'Commentary', language: 'en', selected: false }
      ],
      subtitles: [{ id: '3', label: 'fr', language: 'fr', selected: false }]
    })
  })

  it('reset() returns to the pre-load loading state', () => {
    const t = loaded()
    t.translate({ event: 'property-change', name: 'pause', data: true }) // paused
    t.reset()
    // After reset, a pre-load pause observation is suppressed again.
    expect(t.translate({ event: 'property-change', name: 'pause', data: false })).toEqual([])
    expect(t.translate({ event: 'file-loaded' })).toEqual([{ type: 'state', state: 'playing' }])
  })
})

describe('tracksFromList', () => {
  it('tolerates non-array / malformed input', () => {
    expect(tracksFromList(null)).toEqual({ audio: [], subtitles: [] })
    expect(tracksFromList([{ type: 'audio' }])).toEqual({ audio: [], subtitles: [] })
  })
})

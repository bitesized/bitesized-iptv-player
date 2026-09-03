import { describe, expect, it } from 'vitest'
import { classifyEntry, parseExtinfAttrs, parseHeader, parseM3u } from '@main/services/m3u/parser'
import type { M3uEntry } from '@main/services/m3u/parser'

async function collect(lines: string[]): Promise<M3uEntry[]> {
  const out: M3uEntry[] = []
  for await (const entry of parseM3u(lines)) out.push(entry)
  return out
}

describe('parseExtinfAttrs', () => {
  it('parses quoted attributes', () => {
    const attrs = parseExtinfAttrs(
      '#EXTINF:-1 tvg-id="ch1.uk" tvg-name="Channel One" tvg-logo="http://x/l.png" group-title="News",Channel One HD'
    )
    expect(attrs).toEqual({
      'tvg-id': 'ch1.uk',
      'tvg-name': 'Channel One',
      'tvg-logo': 'http://x/l.png',
      'group-title': 'News'
    })
  })

  it('parses unquoted attributes and tvg-chno', () => {
    const attrs = parseExtinfAttrs('#EXTINF:-1 tvg-chno=42 tvg-id=abc,Name')
    expect(attrs['tvg-chno']).toBe('42')
    expect(attrs['tvg-id']).toBe('abc')
  })

  it('keeps commas inside quoted attributes out of the name split', async () => {
    const entries = await collect([
      '#EXTM3U',
      '#EXTINF:-1 group-title="News, Politics" tvg-id="a",The Channel',
      'http://host/stream'
    ])
    expect(entries[0]!.attrs['group-title']).toBe('News, Politics')
    // Known limitation: lastIndexOf(',') puts quoted-comma content at risk of
    // truncating the display name only when the comma is in the LAST attr and
    // no display name follows — providers virtually always append a name.
    expect(entries[0]!.url).toBe('http://host/stream')
  })
})

describe('parseM3u', () => {
  it('parses a typical playlist', async () => {
    const entries = await collect([
      '#EXTM3U url-tvg="http://epg.example/guide.xml.gz"',
      '#EXTINF:-1 tvg-id="one.uk" tvg-logo="http://l/1.png" group-title="General",One',
      'http://host:8080/live/u/p/1.ts',
      '#EXTINF:-1 group-title="Movies | Action",Die Hard (1988)',
      'http://host:8080/movie/u/p/900.mkv',
      '',
      '#EXTINF:0,Bare Channel',
      'http://host:8080/live/u/p/2.ts'
    ])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      name: 'One',
      url: 'http://host:8080/live/u/p/1.ts',
      attrs: { 'tvg-id': 'one.uk', 'group-title': 'General' }
    })
    expect(entries[1]!.name).toBe('Die Hard (1988)')
    expect(entries[2]!.name).toBe('Bare Channel')
  })

  it('reports the header EPG url', async () => {
    let epgUrl: string | null = null
    for await (const _ of parseM3u(['#EXTM3U url-tvg="http://epg/x.xml"'], (h) => {
      epgUrl = h.epgUrl
    })) {
      // no entries
    }
    expect(epgUrl).toBe('http://epg/x.xml')
  })

  it('ignores unknown directives and blank lines', async () => {
    const entries = await collect([
      '#EXTM3U',
      '#EXTGRP:Something',
      '#EXTINF:-1,Ch',
      '#EXTVLCOPT:http-user-agent=X',
      'http://host/s.ts'
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.url).toBe('http://host/s.ts')
  })

  it('streams a 100k-entry playlist without materializing it', async () => {
    function* lines(): Generator<string> {
      yield '#EXTM3U'
      for (let i = 0; i < 100_000; i++) {
        yield `#EXTINF:-1 tvg-id="ch${i}" group-title="Group ${i % 50}",Channel ${i}`
        yield `http://host/live/${i}.ts`
      }
    }
    let count = 0
    const start = performance.now()
    for await (const _ of parseM3u(lines())) count++
    const elapsed = performance.now() - start
    expect(count).toBe(100_000)
    expect(elapsed).toBeLessThan(5000)
  })
})

describe('classifyEntry', () => {
  const entry = (url: string, group?: string): M3uEntry => ({
    name: 'X',
    url,
    attrs: group ? { 'group-title': group } : {},
    durationSecs: null
  })

  it('classifies by extension', () => {
    expect(classifyEntry(entry('http://h/x.ts'))).toBe('live')
    expect(classifyEntry(entry('http://h/x.m3u8'))).toBe('live')
    expect(classifyEntry(entry('http://h/x.mkv'))).toBe('vod')
    expect(classifyEntry(entry('http://h/x.mp4?token=1'))).toBe('vod')
  })

  it('classifies by group hint', () => {
    expect(classifyEntry(entry('http://h/stream', 'VOD | Action'))).toBe('vod')
    expect(classifyEntry(entry('http://h/stream', 'Movies FR'))).toBe('vod')
    expect(classifyEntry(entry('http://h/stream', 'News'))).toBe('live')
  })
})

describe('parseHeader', () => {
  it('supports x-tvg-url too', () => {
    expect(parseHeader('#EXTM3U x-tvg-url="http://epg/y.xml"').epgUrl).toBe('http://epg/y.xml')
    expect(parseHeader('#EXTM3U').epgUrl).toBeNull()
  })
})

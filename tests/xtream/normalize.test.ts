import { describe, expect, it } from 'vitest'
import {
  asBool,
  asEpoch,
  asNumber,
  asString,
  normalizeCategory,
  normalizeEpisode,
  normalizeLiveStream,
  normalizeSeries,
  normalizeVodStream,
  normalizeVodSubtitles,
  parseMaxConnections,
  parseQuality,
  parseYear
} from '@main/services/xtream/normalize'

describe('coercions', () => {
  it('asString handles strings, numbers, junk', () => {
    expect(asString(' hello ')).toBe('hello')
    expect(asString('')).toBeNull()
    expect(asString('   ')).toBeNull()
    expect(asString(42)).toBe('42')
    expect(asString(null)).toBeNull()
    expect(asString(undefined)).toBeNull()
    expect(asString({})).toBeNull()
  })

  it('asNumber parses numeric strings and rejects junk', () => {
    expect(asNumber('42')).toBe(42)
    expect(asNumber('4.5')).toBe(4.5)
    expect(asNumber(7)).toBe(7)
    expect(asNumber('abc')).toBeNull()
    expect(asNumber(null)).toBeNull()
    expect(asNumber(Infinity)).toBeNull()
  })

  it('asBool treats "1"/1 as true and "0"/0/missing as false', () => {
    expect(asBool('1')).toBe(true)
    expect(asBool(1)).toBe(true)
    expect(asBool('0')).toBe(false)
    expect(asBool(0)).toBe(false)
    expect(asBool(undefined)).toBe(false)
    expect(asBool(true)).toBe(true)
  })

  it('asEpoch converts millisecond timestamps to seconds', () => {
    expect(asEpoch('1700000000')).toBe(1_700_000_000)
    expect(asEpoch(1_700_000_000_000)).toBe(1_700_000_000)
  })

  it('normalizeVodSubtitles handles object + string entries and drops non-URLs', () => {
    const subs = normalizeVodSubtitles({
      info: {
        subtitles: [
          { url: 'http://h/en.srt', language: 'English', name: 'EN Full' },
          { src: 'https://h/fr.vtt', lang: 'fr' },
          'http://h/plain.srt',
          { file: 'relative/only.srt' }, // not absolute → dropped
          'not a url', // dropped
          42 // dropped
        ]
      }
    })
    expect(subs).toEqual([
      { url: 'http://h/en.srt', language: 'English', label: 'EN Full' },
      { url: 'https://h/fr.vtt', language: 'fr', label: 'fr' },
      { url: 'http://h/plain.srt', language: null, label: 'Subtitle' }
    ])
  })

  it('normalizeVodSubtitles returns [] when there are none', () => {
    expect(normalizeVodSubtitles({})).toEqual([])
    expect(normalizeVodSubtitles({ info: {} })).toEqual([])
  })

  it('parseYear takes the last plausible 4-digit year, else null', () => {
    expect(parseYear('The Matrix (1999)')).toBe(1999)
    expect(parseYear('Blade Runner 2049 (2017)')).toBe(2017)
    expect(parseYear('No year here')).toBeNull()
    expect(parseYear('Movie 1899')).toBeNull()
  })

  it('parseQuality maps common tokens to a bucket', () => {
    expect(parseQuality('Movie 4K UHD')).toBe('4K')
    expect(parseQuality('Movie 1080p')).toBe('1080p')
    expect(parseQuality('Show HD')).toBe('720p')
    expect(parseQuality('Old SD')).toBe('SD')
    expect(parseQuality('Plain title')).toBeNull()
  })

  it('normalizeVodStream parses year + quality from the name', () => {
    const row = normalizeVodStream({ stream_id: '1', name: 'The Matrix (1999) 1080p' })
    expect(row?.year).toBe(1999)
    expect(row?.quality).toBe('1080p')
  })

  it('parseMaxConnections reads the cap, mapping 0/missing to null', () => {
    expect(parseMaxConnections({ user_info: { max_connections: '2' } })).toBe(2)
    expect(parseMaxConnections({ user_info: { max_connections: 3 } })).toBe(3)
    // Panels commonly report 0 for "unlimited".
    expect(parseMaxConnections({ user_info: { max_connections: '0' } })).toBeNull()
    expect(parseMaxConnections({ user_info: {} })).toBeNull()
    expect(parseMaxConnections({})).toBeNull()
  })
})

describe('normalizeLiveStream', () => {
  it('normalizes a typical panel row (string-typed numbers)', () => {
    const row = normalizeLiveStream({
      num: '3',
      name: 'Channel One HD',
      stream_type: 'live',
      stream_id: '101',
      stream_icon: 'http://logo/1.png',
      epg_channel_id: 'ch1.example',
      added: '1700000000',
      category_id: '5',
      tv_archive: '1'
    })
    expect(row).toEqual({
      streamId: '101',
      name: 'Channel One HD',
      logo: 'http://logo/1.png',
      streamType: 'live',
      tvArchive: 1,
      epgChannelId: 'ch1.example',
      num: 3,
      addedAt: 1_700_000_000,
      categoryRemoteId: '5'
    })
  })

  it('rejects rows missing stream_id or name', () => {
    expect(normalizeLiveStream({ name: 'No id' })).toBeNull()
    expect(normalizeLiveStream({ stream_id: 5 })).toBeNull()
  })

  it('tolerates null/absent optional fields', () => {
    const row = normalizeLiveStream({ stream_id: 1, name: 'X', epg_channel_id: null })
    expect(row).not.toBeNull()
    expect(row!.epgChannelId).toBeNull()
    expect(row!.logo).toBeNull()
    expect(row!.tvArchive).toBe(0)
  })
})

describe('normalizeVodStream', () => {
  it('normalizes ratings and container extensions', () => {
    const row = normalizeVodStream({
      stream_id: 900,
      name: 'The Matrix',
      rating: '8.7',
      container_extension: 'mkv',
      category_id: 2,
      duration_secs: '8160'
    })
    expect(row!.rating).toBe(8.7)
    expect(row!.containerExt).toBe('mkv')
    expect(row!.durationSecs).toBe(8160)
  })
})

describe('normalizeSeries', () => {
  it('prefers releaseDate but falls back to release_date', () => {
    expect(
      normalizeSeries({ series_id: 1, name: 'S', releaseDate: '2020-01-01' })!.releaseDate
    ).toBe('2020-01-01')
    expect(
      normalizeSeries({ series_id: 1, name: 'S', release_date: '2021-02-02' })!.releaseDate
    ).toBe('2021-02-02')
  })
})

describe('normalizeCategory / normalizeEpisode', () => {
  it('normalizes categories and rejects incomplete ones', () => {
    expect(normalizeCategory({ category_id: 9, category_name: 'News' })).toEqual({
      remoteId: '9',
      name: 'News'
    })
    expect(normalizeCategory({ category_name: 'No id' })).toBeNull()
  })

  it('uses the season argument when the row lacks one', () => {
    const ep = normalizeEpisode({ id: '55', episode_num: '3', title: 'Pilot' }, 2)
    expect(ep).toMatchObject({ season: 2, episodeNum: 3, remoteId: '55', title: 'Pilot' })
  })
})

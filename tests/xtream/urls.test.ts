import { describe, expect, it } from 'vitest'
import {
  formatTimeshiftStart,
  liveStreamUrl,
  normalizeBaseUrl,
  playerApiUrl,
  seriesEpisodeUrl,
  timeshiftUrl,
  vodStreamUrl
} from '@main/services/xtream/urls'

const creds = { baseUrl: 'http://host.example:8080', username: 'user', password: 'pa/ss' }

describe('normalizeBaseUrl', () => {
  it('adds http scheme when missing', () => {
    expect(normalizeBaseUrl('host.example:8080')).toBe('http://host.example:8080')
  })

  it('strips trailing slashes and paths', () => {
    expect(normalizeBaseUrl('http://host.example:8080/some/path/')).toBe('http://host.example:8080')
  })

  it('preserves https and default ports', () => {
    expect(normalizeBaseUrl('https://host.example/')).toBe('https://host.example')
  })

  it('trims whitespace and drops default ports', () => {
    expect(normalizeBaseUrl('  http://host.example:80  ')).toBe('http://host.example')
  })
})

describe('playerApiUrl', () => {
  it('builds the auth URL with no action', () => {
    const url = new URL(playerApiUrl(creds))
    expect(url.pathname).toBe('/player_api.php')
    expect(url.searchParams.get('username')).toBe('user')
    expect(url.searchParams.get('password')).toBe('pa/ss')
    expect(url.searchParams.has('action')).toBe(false)
  })

  it('includes action and extra params', () => {
    const url = new URL(playerApiUrl(creds, 'get_vod_info', { vod_id: 42 }))
    expect(url.searchParams.get('action')).toBe('get_vod_info')
    expect(url.searchParams.get('vod_id')).toBe('42')
  })
})

describe('stream URLs', () => {
  it('builds live URLs with ts default and m3u8 option', () => {
    expect(liveStreamUrl(creds, 123)).toBe('http://host.example:8080/live/user/pa%2Fss/123.ts')
    expect(liveStreamUrl(creds, 123, 'm3u8')).toBe(
      'http://host.example:8080/live/user/pa%2Fss/123.m3u8'
    )
  })

  it('builds vod and series URLs with container extensions', () => {
    expect(vodStreamUrl(creds, 7, 'mkv')).toBe('http://host.example:8080/movie/user/pa%2Fss/7.mkv')
    expect(seriesEpisodeUrl(creds, 99, 'mp4')).toBe(
      'http://host.example:8080/series/user/pa%2Fss/99.mp4'
    )
  })

  it('builds timeshift URLs', () => {
    const url = new URL(timeshiftUrl(creds, 5, '2026-01-01:20-00', 60))
    expect(url.pathname).toBe('/streaming/timeshift.php')
    expect(url.searchParams.get('stream')).toBe('5')
    expect(url.searchParams.get('start')).toBe('2026-01-01:20-00')
    expect(url.searchParams.get('duration')).toBe('60')
  })

  it('formats a timeshift start token from a Date (local time, zero-padded)', () => {
    // Build a local-time Date so the formatter is timezone-agnostic in CI.
    const d = new Date(2026, 0, 5, 9, 7) // 2026-01-05 09:07 local
    expect(formatTimeshiftStart(d)).toBe('2026-01-05:09-07')
  })
})

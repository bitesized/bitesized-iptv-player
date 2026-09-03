import { describe, expect, it } from 'vitest'
import { redactText, redactUrl } from '@main/security/redact'

describe('redactUrl', () => {
  it('masks the username/password query pair an M3U playlist URL carries', () => {
    const redacted = redactUrl(
      'http://host:8080/get.php?username=bob&password=hunter2&type=m3u_plus'
    )
    expect(redacted).not.toContain('bob')
    expect(redacted).not.toContain('hunter2')
    // Still recognisable as the right provider.
    expect(redacted).toContain('host:8080')
    expect(redacted).toContain('type=m3u_plus')
  })

  it('masks the credential pair Xtream puts in the path', () => {
    const redacted = redactUrl('http://host/live/bob/hunter2/12345.ts')
    expect(redacted).not.toContain('bob')
    expect(redacted).not.toContain('hunter2')
    expect(redacted).toContain('12345.ts')
  })

  it('masks userinfo credentials', () => {
    const redacted = redactUrl('http://bob:hunter2@host/list.m3u')
    expect(redacted).not.toContain('hunter2')
    expect(redacted).toContain('host')
  })

  it('is case-insensitive about parameter names', () => {
    expect(redactUrl('http://h/x?Password=hunter2&TOKEN=abc')).not.toContain('hunter2')
    expect(redactUrl('http://h/x?Password=hunter2&TOKEN=abc')).not.toContain('abc')
  })

  it('leaves local playlist paths alone', () => {
    expect(redactUrl('/Users/someone/playlists/list.m3u')).toBe('/Users/someone/playlists/list.m3u')
  })
})

describe('redactText', () => {
  it('strips credentials from URLs quoted inside error messages', () => {
    const message = redactText(
      'Playlist download failed for http://host/get.php?username=bob&password=hunter2 (ECONNRESET)'
    )
    expect(message).not.toContain('hunter2')
    expect(message).toContain('ECONNRESET')
  })
})

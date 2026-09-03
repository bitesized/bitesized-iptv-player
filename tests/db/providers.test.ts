import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { AppDatabase } from '@main/db'
import { migrate } from '@main/db'
import {
  getProvider,
  getProviderUrls,
  insertM3uProvider,
  listProviderOrigins,
  setProviderEpgUrl,
  setProviderStatus
} from '@main/db/repos/providers'

const PLAYLIST = 'http://host:8080/get.php?username=bob&password=hunter2&type=m3u_plus'

describe('provider URL storage', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
  })

  it('keeps the playlist URL out of the plaintext column', () => {
    const provider = insertM3uProvider(db, { name: 'P', m3uUrl: PLAYLIST, epgUrl: null })
    const raw = db
      .prepare('SELECT m3u_url, enc_m3u_url FROM providers WHERE id = ?')
      .get(provider.id) as { m3u_url: string | null; enc_m3u_url: Buffer | null }

    expect(raw.m3u_url).toBeNull()
    expect(raw.enc_m3u_url).not.toBeNull()
  })

  it('round-trips the real URL for main-process use', () => {
    const provider = insertM3uProvider(db, { name: 'P', m3uUrl: PLAYLIST, epgUrl: null })
    expect(getProviderUrls(db, provider.id).m3uUrl).toBe(PLAYLIST)
  })

  it('masks credentials in the record handed to the renderer', () => {
    const provider = insertM3uProvider(db, { name: 'P', m3uUrl: PLAYLIST, epgUrl: null })
    const shown = getProvider(db, provider.id)!
    expect(shown.m3uUrl).not.toContain('hunter2')
    expect(shown.m3uUrl).not.toContain('bob')
    expect(shown.m3uUrl).toContain('host:8080')
  })

  it('reports whether an EPG URL exists separately from its masked value', () => {
    const provider = insertM3uProvider(db, { name: 'P', m3uUrl: PLAYLIST, epgUrl: null })
    expect(getProvider(db, provider.id)!.hasEpgUrl).toBe(false)

    setProviderEpgUrl(db, provider.id, 'http://host/xmltv.php?username=bob&password=hunter2')
    const updated = getProvider(db, provider.id)!
    expect(updated.hasEpgUrl).toBe(true)
    expect(updated.epgUrl).not.toContain('hunter2')
    expect(getProviderUrls(db, provider.id).epgUrl).toContain('hunter2')
  })

  it('redacts credentials quoted in a persisted status message', () => {
    const provider = insertM3uProvider(db, { name: 'P', m3uUrl: PLAYLIST, epgUrl: null })
    setProviderStatus(db, provider.id, 'error', `Download failed for ${PLAYLIST}`)
    expect(getProvider(db, provider.id)!.statusMessage).not.toContain('hunter2')
  })

  it('collects configured origins for the proxy trust list', () => {
    insertM3uProvider(db, { name: 'P', m3uUrl: PLAYLIST, epgUrl: 'http://epg.example/g.xml' })
    const origins = listProviderOrigins(db)
    expect(origins).toContain('http://host:8080')
    expect(origins).toContain('http://epg.example')
  })

  it('migrates a pre-existing plaintext URL into the encrypted column', async () => {
    // Simulate a DB written before migration 8.
    db.prepare(
      "INSERT INTO providers (id, type, name, m3u_url, status) VALUES (9, 'm3u', 'Old', ?, 'ok')"
    ).run(PLAYLIST)
    db.prepare('UPDATE providers SET enc_m3u_url = NULL WHERE id = 9').run()

    const { encryptLegacyProviderUrls } = await import('@main/db')
    encryptLegacyProviderUrls(db)

    const raw = db.prepare('SELECT m3u_url FROM providers WHERE id = 9').get() as {
      m3u_url: string | null
    }
    expect(raw.m3u_url).toBeNull()
    expect(getProviderUrls(db, 9).m3uUrl).toBe(PLAYLIST)
  })
})

// Full IPC surface test: every contract channel must have a handler, and
// every read/query handler is smoke-invoked against a seeded in-memory DB so
// SQL errors (missing columns, bad joins) fail here instead of at runtime.
// (A missing series.added_at column once shipped precisely because no test
// invoked series:page with the 'recent' sort.)

import { beforeAll, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { IPC_CHANNELS } from '@shared/contracts'
import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/contracts'
import type { SyncManager } from '@main/services/syncManager'
import type { EpgService } from '@main/services/epg/epgService'
import type { StreamProxy } from '@main/services/proxy/streamProxy'

const registeredHandlers = new Map<string, (event: unknown, payload: unknown) => unknown>()

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test',
    getAppPath: () => process.cwd(),
    getPath: () => '/tmp'
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      registeredHandlers.set(channel, handler)
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  },
  utilityProcess: { fork: vi.fn() }
}))

async function call<C extends IpcChannel>(
  channel: C,
  payload: IpcRequest<C>
): Promise<IpcResponse<C>> {
  const handler = registeredHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return (await handler({}, payload)) as IpcResponse<C>
}

function seed(db: Database.Database): void {
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'P1')").run()
  db.prepare(
    "INSERT INTO providers (id, type, name, m3u_url) VALUES (2, 'm3u', 'P2', 'http://x/list.m3u')"
  ).run()
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Default')").run()
  db.prepare("INSERT INTO profiles (id, name, is_kids) VALUES (2, 'Kid', 1)").run()

  for (const [id, kind, name] of [
    [1, 'live', 'News'],
    [2, 'vod', 'Action'],
    [3, 'series', 'Drama'],
    [4, 'live', 'Adults XXX']
  ] as const) {
    db.prepare(
      'INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (?, 1, ?, ?, ?)'
    ).run(id, kind, String(id), name)
  }

  db.prepare(
    `INSERT INTO channels (id, provider_id, category_id, stream_id, name, num, added_at, epg_channel_id, tv_archive)
     VALUES (1, 1, 1, '101', 'Channel One', 1, 1700000000, 'one.uk', 1)`
  ).run()
  db.prepare(
    `INSERT INTO channels (id, provider_id, category_id, stream_id, name)
     VALUES (2, 2, NULL, 'http://x/live/2.ts', 'M3U Channel')`
  ).run()
  db.prepare(
    `INSERT INTO vod (id, provider_id, category_id, stream_id, name, added_at, container_ext, rating)
     VALUES (1, 1, 2, '201', 'The Matrix', 1700000100, 'mkv', 8.7)`
  ).run()
  db.prepare(
    `INSERT INTO series (id, provider_id, category_id, series_id, name, added_at)
     VALUES (1, 1, 3, '301', 'Breaking Code', 1700000200)`
  ).run()
  db.prepare(
    `INSERT INTO episodes (id, series_id, season, episode_num, remote_id, title, container_ext)
     VALUES (1, 1, 1, 1, '401', 'Pilot', 'mp4'), (2, 1, 1, 2, '402', 'Second', 'mp4')`
  ).run()
  db.prepare(
    `INSERT INTO epg_programmes (epg_channel_id, start, stop, title)
     VALUES ('one.uk', strftime('%s','now') - 600, strftime('%s','now') + 600, 'On Air Now'),
            ('one.uk', strftime('%s','now') + 600, strftime('%s','now') + 1200, 'Up Next')`
  ).run()
}

let seededDb: Database.Database | null = null

beforeAll(async () => {
  const { migrate } = await import('@main/db')
  const { registerIpcHandlers } = await import('@main/ipc/handlers')

  const db = new Database(':memory:')
  seededDb = db
  db.pragma('foreign_keys = ON')
  migrate(db)
  seed(db)

  const syncManager = {
    syncProvider: vi.fn().mockResolvedValue(undefined)
  } as unknown as SyncManager
  const epgService = {
    hydrateChannel: vi.fn().mockResolvedValue(undefined),
    ingestXmltv: vi.fn().mockResolvedValue(0)
  } as unknown as EpgService
  const streamProxy = {
    origin: 'http://127.0.0.1:9999',
    register: (url: string) =>
      `http://127.0.0.1:9999/s/${'a'.repeat(32)}?src=${encodeURIComponent(url)}`,
    registerImage: (url: string | null) =>
      url === null ? null : `http://127.0.0.1:9999/img?u=${encodeURIComponent(url)}`,
    ownsUrl: (url: string) => url.startsWith('http://127.0.0.1:9999'),
    setTrustedOrigins: vi.fn()
  } as unknown as StreamProxy

  registerIpcHandlers(db, syncManager, epgService, streamProxy)
})

describe('handler coverage', () => {
  it('registers a handler for every channel in the contract', () => {
    const missing = IPC_CHANNELS.filter((channel) => !registeredHandlers.has(channel))
    expect(missing).toEqual([])
  })

  it('registers no handlers outside the contract', () => {
    const contract = new Set<string>(IPC_CHANNELS)
    const extra = [...registeredHandlers.keys()].filter((channel) => !contract.has(channel))
    expect(extra).toEqual([])
  })
})

describe('browse smoke matrix — every page query variant must run', () => {
  const categoryIds = [undefined, 'all', 'favorites', 'recent', 'uncategorized', 1] as const
  const sorts = [undefined, 'name', 'added', 'num'] as const
  const pages = ['channels:page', 'vod:page', 'series:page'] as const

  for (const page of pages) {
    for (const categoryId of categoryIds) {
      for (const sort of sorts) {
        it(`${page} categoryId=${String(categoryId)} sort=${String(sort)}`, async () => {
          const result = await call(page, {
            cursor: null,
            limit: 10,
            profileId: 1,
            ...(categoryId !== undefined ? { categoryId } : {}),
            ...(sort !== undefined ? { sort } : {})
          })
          expect(Array.isArray(result.items)).toBe(true)
        })
      }
    }
  }

  it('pages with a kids profile applied', async () => {
    for (const page of pages) {
      const result = await call(page, { cursor: null, limit: 10, profileId: 2 })
      expect(Array.isArray(result.items)).toBe(true)
    }
  })

  it('walks cursors to exhaustion without error', async () => {
    let cursor: string | null = null
    let guard = 0
    do {
      const page: IpcResponse<'channels:page'> = await call('channels:page', {
        cursor,
        limit: 1
      })
      cursor = page.nextCursor
      guard++
    } while (cursor && guard < 10)
    expect(guard).toBeLessThan(10)
  })
})

describe('catalog handlers', () => {
  it('categories:list for every kind, with and without filters', async () => {
    for (const kind of ['live', 'vod', 'series'] as const) {
      expect(Array.isArray(await call('categories:list', { kind }))).toBe(true)
      expect(Array.isArray(await call('categories:list', { kind, providerId: 1 }))).toBe(true)
      expect(Array.isArray(await call('categories:list', { kind, profileId: 2 }))).toBe(true)
    }
  })

  it('search:query for every kind', async () => {
    for (const kind of ['live', 'vod', 'series'] as const) {
      const result = await call('search:query', {
        term: 'a',
        kind,
        cursor: null,
        limit: 10,
        profileId: 1
      })
      expect(Array.isArray(result.items)).toBe(true)
    }
  })

  it('vod:detail and series:detail return items; unknown ids throw', async () => {
    expect((await call('vod:detail', { vodId: 1 })).name).toBe('The Matrix')
    expect((await call('series:detail', { seriesId: 1 })).name).toBe('Breaking Code')
    await expect(call('vod:detail', { vodId: 999 })).rejects.toThrow()
    await expect(call('series:detail', { seriesId: 999 })).rejects.toThrow()
  })

  it('series:episodes serves cached episodes without provider access', async () => {
    const episodes = await call('series:episodes', { seriesId: 1 })
    expect(episodes.map((e) => e.title)).toEqual(['Pilot', 'Second'])
  })

  it('episodes:next walks the season and ends with null', async () => {
    expect(await call('episodes:next', { episodeId: 1 })).toEqual({ nextEpisodeId: 2 })
    expect(await call('episodes:next', { episodeId: 2 })).toEqual({ nextEpisodeId: null })
    expect(await call('episodes:next', { episodeId: 999 })).toEqual({ nextEpisodeId: null })
  })

  it('stream:url proxies m3u items and errors cleanly for unknown items', async () => {
    const m3u = await call('stream:url', { itemType: 'live', itemId: 2 })
    expect(m3u.url).toContain('127.0.0.1')
    await expect(call('stream:url', { itemType: 'live', itemId: 999 })).rejects.toThrow()
    // Xtream item without stored credentials must throw a clean error.
    await expect(call('stream:url', { itemType: 'vod', itemId: 1 })).rejects.toThrow()
  })
})

describe('profiles, favorites, history', () => {
  it('profiles:list / create / verifyPin / delete round-trip', async () => {
    const created = await call('profiles:create', {
      name: 'Test',
      avatar: null,
      isKids: false,
      pin: '1234'
    })
    expect(created.hasPin).toBe(true)
    expect(await call('profiles:verifyPin', { profileId: created.id, pin: '1234' })).toEqual({
      ok: true
    })
    expect(await call('profiles:verifyPin', { profileId: created.id, pin: '0000' })).toEqual({
      ok: false
    })
    await call('profiles:delete', { profileId: created.id })
    const profiles = await call('profiles:list', undefined)
    expect(profiles.find((p) => p.id === created.id)).toBeUndefined()
  })

  it('favorites toggle on/off and list', async () => {
    expect(await call('favorites:toggle', { profileId: 1, itemType: 'vod', itemId: 1 })).toEqual({
      favorited: true
    })
    expect(await call('favorites:list', { profileId: 1, itemType: 'vod' })).toEqual([
      { itemType: 'vod', itemId: 1 }
    ])
    expect(await call('favorites:toggle', { profileId: 1, itemType: 'vod', itemId: 1 })).toEqual({
      favorited: false
    })
  })

  it('history upsert → position → continue-watching (hydrated)', async () => {
    await call('history:upsert', {
      profileId: 1,
      itemType: 'vod',
      itemId: 1,
      positionSecs: 120,
      durationSecs: 3600
    })
    expect(await call('history:position', { profileId: 1, itemType: 'vod', itemId: 1 })).toBe(120)

    const rows = await call('history:continueWatching', { profileId: 1, limit: 10 })
    expect(rows[0]).toMatchObject({ itemType: 'vod', itemId: 1, name: 'The Matrix' })

    // Watching >95% marks completed and drops it from continue-watching.
    await call('history:upsert', {
      profileId: 1,
      itemType: 'vod',
      itemId: 1,
      positionSecs: 3590,
      durationSecs: 3600
    })
    expect(await call('history:continueWatching', { profileId: 1, limit: 10 })).toEqual([])
  })

  it('episode history entries hydrate series metadata', async () => {
    await call('history:upsert', {
      profileId: 1,
      itemType: 'episode',
      itemId: 1,
      positionSecs: 60,
      durationSecs: 1200
    })
    const rows = await call('history:continueWatching', { profileId: 1, limit: 10 })
    expect(rows[0]).toMatchObject({
      itemType: 'episode',
      seriesName: 'Breaking Code',
      season: 1,
      episodeNum: 1
    })
  })
})

describe('zapping and dialogs', () => {
  it('channels:adjacent walks the num-ordered list across providers boundaries', async () => {
    // Seeded: channel 1 (provider 1, num 1) and channel 2 (provider 2, no num).
    expect(await call('channels:adjacent', { channelId: 1 })).toEqual({
      prevId: null,
      nextId: null // provider 1 has a single channel
    })
    expect(await call('channels:adjacent', { channelId: 999 })).toEqual({
      prevId: null,
      nextId: null
    })
  })

  it('channels:adjacent orders numbered channels before number-less ones', async () => {
    // Add more channels to provider 1: num 2 and one without num.
    const db = seededDb!
    db.prepare(
      "INSERT INTO channels (id, provider_id, stream_id, name, num) VALUES (10, 1, 's10', 'Two', 2)"
    ).run()
    db.prepare(
      "INSERT INTO channels (id, provider_id, stream_id, name) VALUES (11, 1, 's11', 'NoNum')"
    ).run()

    expect(await call('channels:adjacent', { channelId: 1 })).toEqual({
      prevId: null,
      nextId: 10
    })
    expect(await call('channels:adjacent', { channelId: 10 })).toEqual({
      prevId: 1,
      nextId: 11
    })
    expect(await call('channels:adjacent', { channelId: 11 })).toEqual({
      prevId: 10,
      nextId: null
    })
  })

  it('dialog:pickPlaylist returns null when cancelled', async () => {
    expect(await call('dialog:pickPlaylist', undefined)).toBeNull()
  })

  it('providers:setEpgUrl persists and refreshEpg requires a URL', async () => {
    await expect(call('providers:refreshEpg', { providerId: 1 })).rejects.toThrow(/no EPG URL/)
    await call('providers:setEpgUrl', { providerId: 1, epgUrl: 'http://epg/x.xml' })
    // The mocked EpgService resolves 0 programmes.
    expect(await call('providers:refreshEpg', { providerId: 1 })).toEqual({ programmes: 0 })
    await call('providers:setEpgUrl', { providerId: 1, epgUrl: null })
  })
})

describe('EPG handlers', () => {
  it('epg:window returns programmes in range', async () => {
    const now = Math.floor(Date.now() / 1000)
    const rows = await call('epg:window', {
      epgChannelIds: ['one.uk'],
      from: now - 3600,
      to: now + 3600
    })
    expect(rows.map((p) => p.title)).toEqual(['On Air Now', 'Up Next'])
  })

  it('epg:nowNext maps now and next per channel and handles unknowns', async () => {
    const result = await call('epg:nowNext', { channelIds: [1, 2, 999] })
    const one = result.find((r) => r.channelId === 1)!
    expect(one.now?.title).toBe('On Air Now')
    expect(one.next?.title).toBe('Up Next')
    const m3uChannel = result.find((r) => r.channelId === 2)!
    expect(m3uChannel.now).toBeNull()
  })

  it('epg:hydrate delegates to the EPG service', async () => {
    await expect(call('epg:hydrate', { channelId: 1 })).resolves.toBeUndefined()
  })
})

describe('settings and app handlers', () => {
  it('settings get/set round-trip; missing keys are null', async () => {
    expect(await call('settings:get', { key: 'nope' })).toBeNull()
    await call('settings:set', { key: 'theme', value: 'dark' })
    expect(await call('settings:get', { key: 'theme' })).toBe('dark')
    await call('settings:set', { key: 'theme', value: 'oled' })
    expect(await call('settings:get', { key: 'theme' })).toBe('oled')
  })

  it('app:version answers', async () => {
    expect(await call('app:version', undefined)).toBe('0.1.0-test')
  })

  it('providers:list returns seeded providers', async () => {
    const providers = await call('providers:list', undefined)
    expect(providers.map((p) => p.type).sort()).toEqual(['m3u', 'xtream'])
  })

  it('player:capabilities reports an engine', async () => {
    const caps = await call('player:capabilities', undefined)
    expect(['mpv', 'web']).toContain(caps.engine)
  })

  it('player:command and player:stop are safe with no active player', async () => {
    await expect(call('player:command', { action: 'play' })).resolves.toBeUndefined()
    await expect(call('player:stop', undefined)).resolves.toBeUndefined()
  })
})

describe('renderer never receives provider stream locators or raw artwork', () => {
  // For an M3U provider the stream locator *is* the credentialed playlist URL,
  // and raw artwork URLs would let a provider-supplied logo track browsing.
  it('strips streamId from channel pages and proxies the logo', async () => {
    const page = await call('channels:page', { cursor: null, limit: 10, profileId: 1 })
    expect(page.items.length).toBeGreaterThan(0)
    for (const item of page.items) {
      expect(item).not.toHaveProperty('streamId')
      if (item.logo !== null) expect(item.logo).toMatch(/^http:\/\/127\.0\.0\.1:9999\/img\?/)
    }
  })

  it('strips streamId from vod pages and detail', async () => {
    const page = await call('vod:page', { cursor: null, limit: 10, profileId: 1 })
    for (const item of page.items) expect(item).not.toHaveProperty('streamId')

    const first = page.items[0]
    if (first) {
      const detail = await call('vod:detail', { vodId: first.id })
      expect(detail).not.toHaveProperty('streamId')
    }
  })

  it('strips seriesId from series pages and detail', async () => {
    const page = await call('series:page', { cursor: null, limit: 10, profileId: 1 })
    for (const item of page.items) expect(item).not.toHaveProperty('seriesId')

    const first = page.items[0]
    if (first) {
      const detail = await call('series:detail', { seriesId: first.id })
      expect(detail).not.toHaveProperty('seriesId')
    }
  })

  it('strips locators from search results of every kind', async () => {
    for (const [kind, key] of [
      ['live', 'streamId'],
      ['vod', 'streamId'],
      ['series', 'seriesId']
    ] as const) {
      const page = await call('search:query', { term: 'a', kind, cursor: null, limit: 10 })
      for (const item of page.items) expect(item).not.toHaveProperty(key)
    }
  })
})

describe('mpv only accepts URLs main minted', () => {
  it('refuses a local file path passed to player:load', async () => {
    await expect(call('player:load', { url: 'file:///etc/passwd', live: false })).rejects.toThrow(
      /non-proxied/i
    )
  })

  it('refuses an arbitrary remote host passed to player:load', async () => {
    await expect(
      call('player:load', { url: 'http://evil.example/x.ts', live: true })
    ).rejects.toThrow(/non-proxied/i)
  })

  it('refuses a non-proxied subtitle path', async () => {
    await expect(
      call('player:command', { action: 'addSubtitleFile', path: '/etc/passwd' })
    ).rejects.toThrow(/non-proxied/i)
  })
})

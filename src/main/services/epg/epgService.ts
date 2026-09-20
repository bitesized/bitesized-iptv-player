// EPG orchestration: Xtream per-channel hydration (with TTL + a small queue
// so a guide screen full of channels doesn't stampede the provider) and
// XMLTV ingestion for M3U/auxiliary sources.

import { createGunzip } from 'node:zlib'
import { Readable, pipeline } from 'node:stream'
import { Agent, fetch } from 'undici'
import type { AppDatabase } from '@main/db'
import { getChannelById } from '@main/db/repos/browse'
import { purgeOldProgrammes, upsertProgrammes } from '@main/db/repos/epg'
import type { ProgrammeRow } from '@main/db/repos/epg'
import { getXtreamCredentials } from '@main/services/catalogService'
import { XtreamClient } from '@main/services/xtream/client'
import { asEpoch, asString } from '@main/services/xtream/normalize'
import { effectiveEpgChannelId } from '@shared/epg'
import { parseXmltv } from './xmltv'

// Idle timeouts rather than a wall-clock cap — a full XMLTV guide is large and
// slow, but a socket that goes quiet for a minute is dead.
const xmltvDispatcher = new Agent({ headersTimeout: 30_000, bodyTimeout: 60_000 })

const HYDRATE_TTL_MS = 30 * 60_000
const MAX_CONCURRENT_HYDRATIONS = 2

/** Xtream panels base64-encode EPG titles/descriptions; some don't. */
export function decodeMaybeBase64(value: string | null): string | null {
  if (value === null) return null
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value) || value.length % 4 !== 0) return value
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    // Reject decodes that produce control characters — it wasn't base64.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return value
    return decoded
  } catch {
    return value
  }
}

export class EpgService {
  private readonly hydratedAt = new Map<number, number>()
  private readonly inflight = new Map<number, Promise<void>>()
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly db: AppDatabase) {}

  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_HYDRATIONS) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active++
  }

  private release(): void {
    this.active--
    this.waiting.shift()?.()
  }

  /** Fetch + store the full EPG table for one channel (TTL-deduped). */
  hydrateChannel(channelId: number): Promise<void> {
    const last = this.hydratedAt.get(channelId)
    if (last && Date.now() - last < HYDRATE_TTL_MS) return Promise.resolve()

    const existing = this.inflight.get(channelId)
    if (existing) return existing

    const task = this.doHydrate(channelId).finally(() => this.inflight.delete(channelId))
    this.inflight.set(channelId, task)
    return task
  }

  private async doHydrate(channelId: number): Promise<void> {
    await this.acquire()
    try {
      const channel = getChannelById(this.db, channelId)
      if (!channel) return
      const creds = getXtreamCredentials(this.db, channel.providerId)
      const listings = await new XtreamClient(creds).getFullEpg(channel.streamId)

      const epgChannelId = effectiveEpgChannelId(channel)
      const rows: ProgrammeRow[] = []
      for (const listing of listings) {
        const start = asEpoch(listing.start_timestamp)
        const stop = asEpoch(listing.stop_timestamp)
        const title = decodeMaybeBase64(asString(listing.title))
        if (start === null || stop === null || title === null) continue
        rows.push({
          epgChannelId,
          start,
          stop,
          title,
          description: decodeMaybeBase64(asString(listing.description)),
          category: null
        })
      }
      upsertProgrammes(this.db, rows)
      this.hydratedAt.set(channelId, Date.now())
    } catch {
      // EPG is best-effort; missing guide data must never break browsing.
      this.hydratedAt.set(channelId, Date.now() - HYDRATE_TTL_MS + 5 * 60_000)
    } finally {
      this.release()
    }
  }

  /** Download and ingest an XMLTV guide (transparently gunzips .gz). */
  async ingestXmltv(url: string): Promise<number> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IPTVPlayer/0.1' },
      dispatcher: xmltvDispatcher
    })
    if (!response.ok || !response.body) {
      throw new Error(`EPG download failed (HTTP ${response.status})`)
    }
    const download: Readable = Readable.fromWeb(response.body as never)
    let stream: Readable = download
    const contentType = response.headers.get('content-type') ?? ''
    if (url.replace(/\?.*$/, '').endsWith('.gz') || contentType.includes('gzip')) {
      // pipeline, not pipe: a guide download that dies mid-body (undici raises
      // "other side closed") must surface as an error on the stream the parser
      // is listening to, so ingest rejects and the scheduler retries. `pipe`
      // leaves the source error unhandled, which kills the main process.
      const gunzip = createGunzip()
      pipeline(download, gunzip, () => {
        // Handled where it matters: the error reaches the parser via gunzip.
      })
      stream = gunzip
    }

    const buffer: ProgrammeRow[] = []
    const count = await parseXmltv(stream, (row) => {
      buffer.push(row)
      if (buffer.length >= 5000) {
        upsertProgrammes(this.db, buffer.splice(0))
      }
    })
    upsertProgrammes(this.db, buffer)
    purgeOldProgrammes(this.db)
    return count
  }
}

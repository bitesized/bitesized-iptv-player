import { fetch } from 'undici'
import type {
  XtreamAuthResponse,
  XtreamCategory,
  XtreamLiveStream,
  XtreamSeriesInfo,
  XtreamSeriesListItem,
  XtreamShortEpgListing,
  XtreamVodInfo,
  XtreamVodStream
} from './types'
import { playerApiUrl } from './urls'
import type { XtreamCredentials } from './urls'

const USER_AGENT = 'IPTVPlayer/0.1'

/** How long to wait for the provider to start responding at all. */
const FIRST_BYTE_TIMEOUT_MS = 30_000
/**
 * Idle timeout *between* body chunks, not a cap on total download time: a full
 * `get_vod_streams` on a large panel is tens of megabytes and legitimately takes
 * minutes. Only silence on the socket is a failure. (A wall-clock cap here used
 * to abort big movie catalogues mid-download, which surfaced as a bogus
 * "invalid JSON" error.)
 */
const IDLE_TIMEOUT_MS = 60_000
/** Refuse absurd payloads rather than OOM — well above any real catalogue. */
const MAX_RESPONSE_BYTES = 400 * 1024 * 1024

export class XtreamApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'XtreamApiError'
  }
}

export interface XtreamClientTimeouts {
  firstByteMs?: number
  idleMs?: number
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Thin typed client over player_api.php. No retries here — sync orchestration
 * owns retry/backoff policy.
 */
export class XtreamClient {
  private readonly firstByteMs: number
  private readonly idleMs: number

  constructor(
    private readonly creds: XtreamCredentials,
    timeouts: XtreamClientTimeouts = {}
  ) {
    this.firstByteMs = timeouts.firstByteMs ?? FIRST_BYTE_TIMEOUT_MS
    this.idleMs = timeouts.idleMs ?? IDLE_TIMEOUT_MS
  }

  private async get<T>(action?: string, extra?: Record<string, string | number>): Promise<T> {
    const url = playerApiUrl(this.creds, action, extra)
    const label = action ?? 'auth'

    // One controller for the whole exchange, re-armed on every chunk received,
    // so the deadline tracks silence rather than total elapsed time.
    const controller = new AbortController()
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    const arm = (ms: number): void => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, ms)
    }
    const rearm = (): void => {
      clearTimeout(timer)
      arm(this.idleMs)
    }
    arm(this.firstByteMs)

    try {
      let response
      try {
        response = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: controller.signal
        })
      } catch (err) {
        throw new XtreamApiError(
          timedOut
            ? `Provider did not respond within ${Math.round(this.firstByteMs / 1000)}s (${label})`
            : `Request failed (${label}): ${errText(err)}`
        )
      }
      if (!response.ok) {
        throw new XtreamApiError(
          `HTTP ${response.status} from provider (${label})`,
          response.status
        )
      }

      let body: string
      try {
        body = await this.readBody(response, rearm)
      } catch (err) {
        throw new XtreamApiError(
          timedOut
            ? `Download stalled for ${Math.round(this.idleMs / 1000)}s (${label}) — the provider stopped sending data`
            : `Download failed (${label}): ${errText(err)}`
        )
      }

      try {
        return JSON.parse(body) as T
      } catch (err) {
        throw new XtreamApiError(`Provider returned invalid JSON (${label}): ${errText(err)}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Read the whole body as text, re-arming the idle timer per chunk. Decoding
   * incrementally keeps a single rope-joined string instead of buffering the
   * bytes and copying them again on concat.
   */
  private async readBody(
    response: { body: ReadableStream<Uint8Array> | null },
    onChunk: () => void
  ): Promise<string> {
    if (!response.body) return ''
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    for await (const chunk of response.body) {
      onChunk()
      bytes += chunk.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new Error(`response exceeded ${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)}MB`)
      }
      text += decoder.decode(chunk, { stream: true })
    }
    return text + decoder.decode()
  }

  /** Auth ping — also returns account + server info. Throws on bad creds. */
  async authenticate(): Promise<XtreamAuthResponse> {
    const data = await this.get<XtreamAuthResponse>()
    const auth = data?.user_info?.auth
    if (auth !== 1 && auth !== '1') {
      throw new XtreamApiError('Authentication failed — check host, username and password')
    }
    return data
  }

  getLiveCategories(): Promise<XtreamCategory[]> {
    return this.getArray<XtreamCategory>('get_live_categories')
  }

  getVodCategories(): Promise<XtreamCategory[]> {
    return this.getArray<XtreamCategory>('get_vod_categories')
  }

  getSeriesCategories(): Promise<XtreamCategory[]> {
    return this.getArray<XtreamCategory>('get_series_categories')
  }

  getLiveStreams(categoryId?: string): Promise<XtreamLiveStream[]> {
    return this.getArray<XtreamLiveStream>(
      'get_live_streams',
      categoryId ? { category_id: categoryId } : undefined
    )
  }

  getVodStreams(categoryId?: string): Promise<XtreamVodStream[]> {
    return this.getArray<XtreamVodStream>(
      'get_vod_streams',
      categoryId ? { category_id: categoryId } : undefined
    )
  }

  getSeries(categoryId?: string): Promise<XtreamSeriesListItem[]> {
    return this.getArray<XtreamSeriesListItem>(
      'get_series',
      categoryId ? { category_id: categoryId } : undefined
    )
  }

  getVodInfo(vodId: string | number): Promise<XtreamVodInfo> {
    return this.get<XtreamVodInfo>('get_vod_info', { vod_id: vodId })
  }

  getSeriesInfo(seriesId: string | number): Promise<XtreamSeriesInfo> {
    return this.get<XtreamSeriesInfo>('get_series_info', { series_id: seriesId })
  }

  getShortEpg(streamId: string | number, limit = 10): Promise<XtreamShortEpgListing[]> {
    return this.get<{ epg_listings?: XtreamShortEpgListing[] }>('get_short_epg', {
      stream_id: streamId,
      limit
    }).then((data) => (Array.isArray(data?.epg_listings) ? data.epg_listings : []))
  }

  getFullEpg(streamId: string | number): Promise<XtreamShortEpgListing[]> {
    return this.get<{ epg_listings?: XtreamShortEpgListing[] }>('get_simple_data_table', {
      stream_id: streamId
    }).then((data) => (Array.isArray(data?.epg_listings) ? data.epg_listings : []))
  }

  /** Some panels return `{}`, `null` or an error object instead of `[]`. */
  private async getArray<T>(action: string, extra?: Record<string, string | number>): Promise<T[]> {
    const data = await this.get<unknown>(action, extra)
    return Array.isArray(data) ? (data as T[]) : []
  }
}

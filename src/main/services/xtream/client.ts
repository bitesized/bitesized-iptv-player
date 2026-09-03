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
const REQUEST_TIMEOUT_MS = 30_000

export class XtreamApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'XtreamApiError'
  }
}

/**
 * Thin typed client over player_api.php. No retries here — sync orchestration
 * owns retry/backoff policy.
 */
export class XtreamClient {
  constructor(private readonly creds: XtreamCredentials) {}

  private async get<T>(action?: string, extra?: Record<string, string | number>): Promise<T> {
    const url = playerApiUrl(this.creds, action, extra)
    let response
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (err) {
      throw new XtreamApiError(
        `Request failed (${action ?? 'auth'}): ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (!response.ok) {
      throw new XtreamApiError(
        `HTTP ${response.status} from provider (${action ?? 'auth'})`,
        response.status
      )
    }
    try {
      return (await response.json()) as T
    } catch {
      throw new XtreamApiError(`Provider returned invalid JSON (${action ?? 'auth'})`)
    }
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

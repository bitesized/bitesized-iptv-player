// Scheduled XMLTV refresh (TODO P1). Guide data goes stale — programmes end and
// new ones appear — so beyond the initial post-sync ingest we re-download each
// provider's XMLTV on a TTL, on a periodic tick, and whenever the machine wakes
// from sleep (`onResume`, wired to Electron's powerMonitor in index.ts).
//
// Deliberately free of Electron imports so it unit-tests in isolation; the only
// side effects are `epgService.ingestXmltv` and a persisted last-run timestamp.

import type { AppDatabase } from '@main/db'
import { getProviderUrls, listProviders } from '@main/db/repos/providers'
import type { EpgService } from './epgService'

const REFRESH_TTL_MS = 6 * 60 * 60_000
const CHECK_INTERVAL_MS = 30 * 60_000
const LAST_REFRESH_KEY = 'epg.lastRefreshAt'

export class EpgScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    private readonly db: AppDatabase,
    private readonly epgService: Pick<EpgService, 'ingestXmltv'>
  ) {}

  /** Begin periodic checks and run one immediately (refreshes only if due). */
  start(): void {
    void this.refreshIfDue()
    this.timer = setInterval(() => void this.refreshIfDue(), CHECK_INTERVAL_MS)
    // Don't let the guide timer keep the app alive on its own.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** OS woke from sleep — guide data is likely stale, so check now. */
  onResume(): void {
    void this.refreshIfDue()
  }

  /**
   * Re-ingest every provider's XMLTV if the TTL has elapsed since the last run
   * (or always when `force`). Concurrent calls collapse to one run.
   */
  async refreshIfDue(force = false): Promise<void> {
    if (this.running) return
    if (!force && Date.now() - this.readLastRefresh() < REFRESH_TTL_MS) return
    this.running = true
    try {
      await this.refreshAll()
      this.writeLastRefresh(Date.now())
    } finally {
      this.running = false
    }
  }

  private async refreshAll(): Promise<void> {
    // Distinct URLs only — providers commonly share one XMLTV endpoint.
    // Provider.epgUrl is masked for display, so read the real value here.
    const urls = new Set<string>()
    for (const provider of listProviders(this.db)) {
      const { epgUrl } = getProviderUrls(this.db, provider.id)
      if (epgUrl) urls.add(epgUrl)
    }
    for (const url of urls) {
      // Best-effort: one provider's dead EPG URL must not block the others.
      try {
        await this.epgService.ingestXmltv(url)
      } catch {
        /* ignore — guide is non-critical */
      }
    }
  }

  private readLastRefresh(): number {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(LAST_REFRESH_KEY) as { value: string } | undefined
    return row ? Number(row.value) || 0 : 0
  }

  private writeLastRefresh(ts: number): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(LAST_REFRESH_KEY, String(ts))
  }
}

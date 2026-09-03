import { join } from 'node:path'
import { BrowserWindow, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import type { AppDatabase } from '@main/db'
import {
  getProvider,
  getProviderPassword,
  getProviderUrls,
  setProviderEpgUrl,
  setProviderStatus
} from '@main/db/repos/providers'
import { decryptSecret } from '@main/security/credentials'
import type { EpgService } from '@main/services/epg/epgService'
import type { SyncWorkerMessage, SyncWorkerRequest } from '@main/workers/syncWorker'
import type { SyncProgress } from '@shared/types'

function broadcast(progress: SyncProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('sync:progress', progress)
  }
}

/**
 * Spawns sync utilityProcesses and fans progress out to all windows.
 * One sync per provider at a time; repeat requests while running are no-ops.
 */
export class SyncManager {
  private readonly running = new Map<number, Promise<void>>()
  /** Live worker handle per provider, so an in-flight sync can be cancelled. */
  private readonly workers = new Map<number, UtilityProcess>()
  /** Providers whose sync was deliberately cancelled — suppresses the error
   * status/broadcast the exit handler would otherwise emit for a killed worker. */
  private readonly cancelled = new Set<number>()

  constructor(
    private readonly db: AppDatabase,
    private readonly dbPath: string,
    private readonly epgService?: EpgService
  ) {}

  syncProvider(providerId: number): Promise<void> {
    const existing = this.running.get(providerId)
    if (existing) return existing

    const promise = this.run(providerId).finally(() => this.running.delete(providerId))
    this.running.set(providerId, promise)
    return promise
  }

  /** True while a sync worker is running for this provider. */
  isSyncing(providerId: number): boolean {
    return this.running.has(providerId)
  }

  /**
   * Stop an in-flight sync for a provider and wait for its worker to exit.
   * Safe to call when nothing is running (resolves immediately). Callers that
   * mutate/delete the provider must await this first, so the worker (which holds
   * its own DB connection) can't keep writing rows for a doomed provider.
   */
  async cancelSync(providerId: number): Promise<void> {
    const running = this.running.get(providerId)
    if (!running) return
    this.cancelled.add(providerId)
    this.workers.get(providerId)?.kill()
    // The run() promise rejects (killed worker → non-zero exit); swallow it —
    // cancellation is the expected outcome here, not a failure to report.
    await running.catch(() => {})
    this.cancelled.delete(providerId)
  }

  private async run(providerId: number): Promise<void> {
    const provider = getProvider(this.db, providerId)
    if (!provider) throw new Error(`Provider ${providerId} not found`)

    let request: SyncWorkerRequest
    if (provider.type === 'xtream') {
      const encPassword = getProviderPassword(this.db, providerId)
      if (!provider.baseUrl || !provider.username || !encPassword) {
        throw new Error('Provider is missing credentials')
      }
      request = {
        kind: 'xtream',
        providerId,
        dbPath: this.dbPath,
        creds: {
          baseUrl: provider.baseUrl,
          username: provider.username,
          password: decryptSecret(encPassword)
        }
      }
    } else {
      // Local-file playlists share the column as a plain absolute path.
      // Provider.m3uUrl is masked for the renderer, so read the real value.
      const { m3uUrl } = getProviderUrls(this.db, providerId)
      const isUrl = m3uUrl !== null && /^https?:\/\//i.test(m3uUrl)
      request = {
        kind: 'm3u',
        providerId,
        dbPath: this.dbPath,
        source: {
          url: isUrl ? m3uUrl : null,
          filePath: isUrl ? null : m3uUrl
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      const worker = utilityProcess.fork(join(__dirname, 'syncWorker.js'), [], {
        serviceName: `provider-sync-${providerId}`
      })
      this.workers.set(providerId, worker)
      let settled = false

      worker.on('message', (message: SyncWorkerMessage) => {
        if (message.type === 'progress') {
          broadcast(message.progress)
        } else if (message.type === 'done') {
          settled = true
          this.afterSync(providerId, message.discoveredEpgUrl)
          resolve()
        } else if (message.type === 'error') {
          settled = true
          reject(new Error(message.message))
        }
      })

      worker.on('exit', (code) => {
        this.workers.delete(providerId)
        if (settled) return
        // A deliberately cancelled sync (e.g. provider being deleted) is not a
        // failure: don't touch the — possibly already-deleted — provider row or
        // toast an error. Just reject so the awaiting caller unblocks.
        if (this.cancelled.has(providerId)) {
          reject(new Error('Sync cancelled'))
          return
        }
        const message = `Sync worker exited unexpectedly (code ${code})`
        setProviderStatus(this.db, providerId, 'error', message)
        broadcast({
          providerId,
          stage: 'error',
          processed: 0,
          total: null,
          message
        })
        reject(new Error(message))
      })

      worker.postMessage(request)
    })
  }

  /** Post-sync housekeeping: persist a discovered EPG URL and ingest XMLTV. */
  private afterSync(providerId: number, discoveredEpgUrl: string | null): void {
    const provider = getProvider(this.db, providerId)
    if (!provider) return

    let { epgUrl } = getProviderUrls(this.db, providerId)
    if (!epgUrl && discoveredEpgUrl) {
      setProviderEpgUrl(this.db, providerId, discoveredEpgUrl)
      epgUrl = discoveredEpgUrl
    }

    if (epgUrl && this.epgService) {
      broadcast({ providerId, stage: 'epg', processed: 0, total: null, message: null })
      void this.epgService
        .ingestXmltv(epgUrl)
        .catch(() => {})
        .finally(() =>
          broadcast({ providerId, stage: 'done', processed: 0, total: null, message: null })
        )
    }
  }
}

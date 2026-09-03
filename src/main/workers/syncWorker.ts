// utilityProcess entry for provider sync. Runs fetch + parse + upsert off the
// main process so a 100k-item import never blocks the UI or main's event loop.
// It opens its own SQLite connection (safe alongside main's under WAL).
//
// IMPORTANT: this file must not import 'electron' — it runs as plain Node.

import { openDatabase } from '@main/db'
import { syncM3uProvider } from '@main/services/m3u/sync'
import { syncXtreamProvider } from '@main/services/xtream/sync'
import type { SyncProgress } from '@shared/types'

export type SyncWorkerRequest =
  | {
      kind: 'xtream'
      providerId: number
      dbPath: string
      creds: { baseUrl: string; username: string; password: string }
    }
  | {
      kind: 'm3u'
      providerId: number
      dbPath: string
      source: { url: string | null; filePath: string | null }
    }

export type SyncWorkerMessage =
  | { type: 'progress'; progress: SyncProgress }
  | { type: 'done'; discoveredEpgUrl: string | null }
  | { type: 'error'; message: string }

const port = process.parentPort

port.on('message', (event: { data: SyncWorkerRequest }) => {
  const request = event.data
  const db = openDatabase(request.dbPath)
  const onProgress = (progress: Omit<SyncProgress, 'providerId'>): void => {
    port.postMessage({
      type: 'progress',
      progress: { providerId: request.providerId, ...progress }
    } satisfies SyncWorkerMessage)
  }

  const run = async (): Promise<string | null> => {
    if (request.kind === 'xtream') {
      await syncXtreamProvider(db, request.providerId, request.creds, onProgress)
      return null
    }
    const result = await syncM3uProvider(db, request.providerId, request.source, onProgress)
    return result.epgUrl
  }

  run()
    .then((discoveredEpgUrl) => {
      port.postMessage({ type: 'done', discoveredEpgUrl } satisfies SyncWorkerMessage)
      // Refresh the query planner's stats now that the catalog has changed
      // shape. Without sqlite_stat1 the planner mis-picks between the browse
      // filter indexes and the sort indexes and falls back to sorting the whole
      // catalog per page. `analysis_limit` keeps this bounded on huge tables.
      db.pragma('analysis_limit = 400')
      db.pragma('optimize')
      db.close()
      process.exit(0)
    })
    .catch((err: unknown) => {
      port.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      } satisfies SyncWorkerMessage)
      db.close()
      process.exit(1)
    })
})

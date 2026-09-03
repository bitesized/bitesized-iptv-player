import { useState } from 'react'
import type { SyncProgress } from '@shared/types'
import { useSyncProgress } from '../lib/queries'

const stageLabels: Record<SyncProgress['stage'], string> = {
  connecting: 'Connecting…',
  categories: 'Importing categories…',
  live: 'Importing live channels',
  vod: 'Importing movies',
  series: 'Importing series',
  epg: 'Updating TV guide',
  finalizing: 'Finishing up…',
  done: 'Import complete',
  error: 'Import failed'
}

export function SyncProgressToast(): JSX.Element | null {
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  useSyncProgress((p) => {
    setProgress(p)
    if (p.stage === 'done') {
      setTimeout(() => setProgress((cur) => (cur?.stage === 'done' ? null : cur)), 4000)
    }
  })

  if (!progress) return null

  const detail =
    progress.total !== null && progress.stage !== 'done' && progress.stage !== 'error'
      ? ` ${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
      : ''

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-72 rounded-lg border border-white/10 bg-surface-overlay p-3 shadow-xl">
      <div className="text-sm font-medium text-white">
        {stageLabels[progress.stage]}
        {detail}
      </div>
      {progress.stage === 'error' && progress.message ? (
        <div className="mt-1 text-xs text-red-400">{progress.message}</div>
      ) : null}
      {progress.total !== null && progress.stage !== 'done' && progress.stage !== 'error' ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: `${Math.min(100, (progress.processed / Math.max(1, progress.total)) * 100)}%`
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

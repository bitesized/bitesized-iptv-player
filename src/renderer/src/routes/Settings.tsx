import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Provider } from '@shared/types'
import { invoke } from '../lib/api'
import { useDeleteProvider, useProviders, useSyncProvider } from '../lib/queries'
import { ACCENT_SETTING_KEY, ACCENT_THEMES } from '../lib/accent'
import { useUiStore } from '../stores/ui'
import { CheckIcon } from '../player/icons'

const statusLabels: Record<Provider['status'], { label: string; className: string }> = {
  ok: { label: 'Synced', className: 'text-emerald-400' },
  syncing: { label: 'Syncing…', className: 'text-sky-400' },
  error: { label: 'Error', className: 'text-red-400' },
  never_synced: { label: 'Not synced yet', className: 'text-neutral-400' }
}

function EpgEditor({ provider }: { provider: Provider }): JSX.Element {
  const queryClient = useQueryClient()
  // The stored URL usually embeds credentials, so main only ever hands back a
  // masked copy. Pre-filling the field with that would save the mask over the
  // real URL — instead the field starts empty and means "replace with this".
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (epgUrl: string | null) =>
      invoke('providers:setEpgUrl', { providerId: provider.id, epgUrl }),
    onSuccess: () => {
      setUrl('')
      setMessage('Saved.')
      void queryClient.invalidateQueries({ queryKey: ['providers'] })
    }
  })
  const refresh = useMutation({
    mutationFn: () => invoke('providers:refreshEpg', { providerId: provider.id }),
    onSuccess: ({ programmes }) =>
      setMessage(`Guide updated — ${programmes.toLocaleString()} programmes.`),
    onError: (err) => setMessage(err instanceof Error ? err.message : String(err))
  })

  return (
    <div className="mt-2 border-t border-white/5 pt-2">
      {provider.hasEpgUrl ? (
        <div className="mb-1 truncate text-xs text-neutral-500">Current: {provider.epgUrl}</div>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={provider.hasEpgUrl ? 'Replace EPG URL (XMLTV)' : 'EPG URL (XMLTV, optional)'}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => save.mutate(url.trim())}
          disabled={save.isPending || url.trim().length === 0}
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
        >
          Save
        </button>
        {provider.hasEpgUrl ? (
          <button
            type="button"
            onClick={() => save.mutate(null)}
            disabled={save.isPending}
            className="rounded-md border border-white/10 px-2 py-1 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || !provider.hasEpgUrl}
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh guide'}
        </button>
      </div>
      {message ? <div className="mt-1 text-xs text-neutral-500">{message}</div> : null}
    </div>
  )
}

function ProviderRow({ provider }: { provider: Provider }): JSX.Element {
  const syncProvider = useSyncProvider()
  const deleteProvider = useDeleteProvider()
  const [expanded, setExpanded] = useState(false)
  const status = statusLabels[provider.status]

  return (
    <div className="rounded-lg border border-white/5 bg-surface-raised px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate font-medium text-white">{provider.name}</div>
          <div className="truncate text-xs text-neutral-500">
            {provider.type === 'xtream' ? provider.baseUrl : provider.m3uUrl}
          </div>
          <div className={`text-xs ${status.className}`}>
            {status.label}
            {provider.status === 'error' && provider.statusMessage
              ? ` — ${provider.statusMessage}`
              : ''}
            {provider.lastSyncAt
              ? ` · last sync ${new Date(provider.lastSyncAt * 1000).toLocaleString()}`
              : ''}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/5"
          >
            EPG
          </button>
          <button
            type="button"
            onClick={() => syncProvider.mutate(provider.id)}
            disabled={provider.status === 'syncing' || syncProvider.isPending}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            Re-sync
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove “${provider.name}” and its imported catalog?`)) {
                deleteProvider.mutate(provider.id)
              }
            }}
            className="rounded-md border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
          >
            Remove
          </button>
        </div>
      </div>
      {expanded ? <EpgEditor provider={provider} /> : null}
    </div>
  )
}

function PlaybackSection(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['player', 'capabilities'],
    queryFn: () => invoke('player:capabilities', undefined)
  })
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-medium text-white">Playback</h2>
      <div className="rounded-lg border border-white/5 bg-surface-raised px-4 py-3 text-sm">
        {data?.engine === 'mpv' ? (
          <span className="text-emerald-400">
            mpv engine active — full codec coverage with hardware decoding.
          </span>
        ) : (
          <div className="text-neutral-400">
            <span className="text-amber-400">Web engine fallback in use.</span> Install mpv (
            <code className="text-neutral-300">brew install mpv</code> /{' '}
            <code className="text-neutral-300">apt install mpv</code>) for HEVC, AC3/EAC3 and full
            subtitle support, then restart the app.
          </div>
        )}
      </div>
    </section>
  )
}

function AppearanceSection(): JSX.Element {
  const current = useUiStore((s) => s.accentTheme)
  const setAccentTheme = useUiStore((s) => s.setAccentTheme)

  const choose = (id: string): void => {
    setAccentTheme(id) // live-applies immediately
    void invoke('settings:set', { key: ACCENT_SETTING_KEY, value: id })
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-medium text-white">Appearance</h2>
      <div className="rounded-lg border border-white/5 bg-surface-raised px-4 py-4">
        <div className="mb-3 text-sm text-neutral-400">
          Accent colour — used across buttons, controls and highlights.
        </div>
        <div className="flex flex-wrap gap-4">
          {ACCENT_THEMES.map((theme) => {
            const selected = theme.id === current
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => choose(theme.id)}
                aria-pressed={selected}
                aria-label={theme.label}
                title={theme.label}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                    selected
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-raised'
                      : 'ring-1 ring-white/10 hover:ring-white/30'
                  }`}
                  style={{ backgroundColor: theme.base }}
                >
                  {selected ? (
                    <CheckIcon
                      size={18}
                      className="text-white [filter:drop-shadow(0_1px_1px_rgb(0_0_0/0.5))]"
                    />
                  ) : null}
                </span>
                <span className={`text-xs ${selected ? 'text-white' : 'text-neutral-500'}`}>
                  {theme.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function SettingsScreen(): JSX.Element {
  const { data: providers, isLoading } = useProviders()

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Settings</h1>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">Providers</h2>
          <Link
            to="/onboarding"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
          >
            Add provider
          </Link>
        </div>
        <div className="flex flex-col gap-2">
          {isLoading ? (
            <div className="text-sm text-neutral-500">Loading…</div>
          ) : providers && providers.length > 0 ? (
            providers.map((p) => <ProviderRow key={p.id} provider={p} />)
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-neutral-500">
              No providers yet. Add an Xtream Codes account or M3U playlist to get started.
            </div>
          )}
        </div>
      </section>
      <AppearanceSection />
      <PlaybackSection />
    </div>
  )
}

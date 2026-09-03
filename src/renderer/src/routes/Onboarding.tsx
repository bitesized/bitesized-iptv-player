import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '../lib/api'
import { useAddM3uProvider, useAddXtreamProvider } from '../lib/queries'
import { WindowDragBar } from '../components/WindowDragBar'

type Tab = 'xtream' | 'm3u'

const inputClass =
  'w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-accent'

export function OnboardingScreen(): JSX.Element {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('xtream')

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [m3uUrl, setM3uUrl] = useState('')
  const [m3uFile, setM3uFile] = useState<string | null>(null)
  const [epgUrl, setEpgUrl] = useState('')

  const addXtream = useAddXtreamProvider()
  const addM3u = useAddM3uProvider()
  const pending = addXtream.isPending || addM3u.isPending
  const error = addXtream.error ?? addM3u.error

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (tab === 'xtream') {
      await addXtream.mutateAsync({ name, baseUrl: host, username, password })
    } else {
      await addM3u.mutateAsync({
        name,
        url: m3uFile ? null : m3uUrl || null,
        filePath: m3uFile,
        epgUrl: epgUrl || null
      })
    }
    navigate('/')
  }

  return (
    <div className="relative flex h-full items-center justify-center bg-surface p-8">
      <WindowDragBar />
      <div className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-semibold text-white">Add a provider</h1>
        <p className="mb-6 text-sm text-neutral-400">
          This app ships with no content — connect your own subscription.
        </p>

        <div className="mb-4 flex gap-1 rounded-lg bg-surface-raised p-1">
          {(['xtream', 'm3u'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? 'bg-accent/20 text-accent-hover' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {t === 'xtream' ? 'Xtream Codes' : 'M3U Playlist'}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <input
            className={inputClass}
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {tab === 'xtream' ? (
            <>
              <input
                className={inputClass}
                placeholder="Server (http://host:port)"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
              <input
                className={inputClass}
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="off"
              />
              <input
                className={inputClass}
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="off"
              />
            </>
          ) : (
            <>
              {m3uFile ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-neutral-300">
                  <span className="truncate" title={m3uFile}>
                    {m3uFile.split('/').pop()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setM3uFile(null)}
                    className="shrink-0 text-xs text-neutral-500 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <input
                  className={inputClass}
                  placeholder="Playlist URL (http://…/playlist.m3u)"
                  value={m3uUrl}
                  onChange={(e) => setM3uUrl(e.target.value)}
                  required={!m3uFile}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  void invoke('dialog:pickPlaylist', undefined).then((path) => {
                    if (path) setM3uFile(path)
                  })
                }}
                className="rounded-md border border-white/10 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5"
              >
                {m3uFile ? 'Choose a different file…' : 'Or choose a local file…'}
              </button>
              <input
                className={inputClass}
                placeholder="EPG URL (XMLTV, optional)"
                value={epgUrl}
                onChange={(e) => setEpgUrl(e.target.value)}
              />
            </>
          )}

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error instanceof Error ? error.message : String(error)}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? 'Validating…' : 'Connect & import'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Skip for now
          </button>
        </form>
      </div>
    </div>
  )
}

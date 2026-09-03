import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Profile } from '@shared/types'
import { invoke } from '../lib/api'
import { useUiStore } from '../stores/ui'
import { WindowDragBar } from '../components/WindowDragBar'

const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐧', '🚀']

const inputClass =
  'w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-accent'

function PinPrompt({
  profile,
  onCancel,
  onUnlocked
}: {
  profile: Profile
  onCancel: () => void
  onUnlocked: () => void
}): JSX.Element {
  const [pin, setPin] = useState('')
  const [failed, setFailed] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const { ok } = await invoke('profiles:verifyPin', { profileId: profile.id, pin })
    if (ok) onUnlocked()
    else {
      setFailed(true)
      setPin('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-72 rounded-lg border border-white/10 bg-surface-raised p-5"
      >
        <div className="mb-3 text-sm font-medium text-white">Enter PIN for {profile.name}</div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className={inputClass}
          placeholder="PIN"
        />
        {failed ? <div className="mt-2 text-xs text-red-400">Wrong PIN — try again.</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
          >
            Unlock
          </button>
        </div>
      </form>
    </div>
  )
}

export function ProfilesScreen(): JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setActiveProfile = useUiStore((s) => s.setActiveProfile)

  const { data: profiles } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => invoke('profiles:list', undefined)
  })

  const [pinTarget, setPinTarget] = useState<Profile | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0]!)
  const [isKids, setIsKids] = useState(false)
  const [pin, setPin] = useState('')

  const createMutation = useMutation({
    mutationFn: () => invoke('profiles:create', { name, avatar, isKids, pin: pin.trim() || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setCreating(false)
      setName('')
      setPin('')
      setIsKids(false)
    }
  })
  const deleteMutation = useMutation({
    mutationFn: (profileId: number) => invoke('profiles:delete', { profileId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profiles'] })
  })

  const activate = (profile: Profile): void => {
    setActiveProfile(profile.id)
    navigate('/')
  }

  const select = (profile: Profile): void => {
    if (profile.hasPin) setPinTarget(profile)
    else activate(profile)
  }

  return (
    <div className="relative flex h-screen flex-col items-center justify-center bg-surface p-8">
      <WindowDragBar />
      <h1 className="mb-8 text-2xl font-semibold text-white">Who's watching?</h1>
      <div className="flex flex-wrap items-start justify-center gap-6">
        {(profiles ?? []).map((profile) => (
          <div key={profile.id} className="group flex w-28 flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => select(profile)}
              className="flex h-24 w-24 items-center justify-center rounded-2xl bg-surface-raised text-5xl transition-transform hover:scale-105 hover:ring-2 hover:ring-accent"
            >
              {profile.avatar ?? '👤'}
            </button>
            <div className="flex items-center gap-1 text-sm text-neutral-300">
              {profile.hasPin ? <span title="PIN protected">🔒</span> : null}
              {profile.isKids ? <span title="Kids profile">🧒</span> : null}
              <span className="truncate">{profile.name}</span>
            </div>
            {(profiles?.length ?? 0) > 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete profile “${profile.name}”?`)) {
                    deleteMutation.mutate(profile.id)
                  }
                }}
                className="text-[10px] text-neutral-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
              >
                Delete
              </button>
            ) : null}
          </div>
        ))}

        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) createMutation.mutate()
            }}
            className="flex w-64 flex-col gap-2 rounded-lg border border-white/10 bg-surface-raised p-4"
          >
            <input
              autoFocus
              className={inputClass}
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAvatar(a)}
                  className={`rounded-md p-1 text-xl ${a === avatar ? 'bg-accent/30' : 'hover:bg-white/10'}`}
                >
                  {a}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={isKids}
                onChange={(e) => setIsKids(e.target.checked)}
              />
              Kids profile (hides adult categories)
            </label>
            <input
              className={inputClass}
              type="password"
              inputMode="numeric"
              placeholder="PIN (optional)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-dashed border-white/15 text-3xl text-neutral-500 transition-colors hover:border-accent hover:text-accent-hover"
          >
            +
          </button>
        )}
      </div>

      {pinTarget ? (
        <PinPrompt
          profile={pinTarget}
          onCancel={() => setPinTarget(null)}
          onUnlocked={() => {
            setPinTarget(null)
            activate(pinTarget)
          }}
        />
      ) : null}
    </div>
  )
}

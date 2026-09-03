import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { invoke } from '../lib/api'
import { useUiStore } from '../stores/ui'
import { SyncProgressToast } from './SyncProgressToast'
import { WindowDragBar } from './WindowDragBar'

const navItems = [
  { to: '/', label: 'Home', end: true },
  { to: '/live', label: 'Live TV' },
  { to: '/vod', label: 'Movies' },
  { to: '/series', label: 'Series' },
  { to: '/favorites', label: 'Favorites' },
  { to: '/guide', label: 'TV Guide' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' }
]

export function AppShell(): JSX.Element {
  const navigate = useNavigate()
  const activeProfileId = useUiStore((s) => s.activeProfileId)
  const setActiveProfile = useUiStore((s) => s.setActiveProfile)

  // No active profile yet: auto-enter a lone PIN-less profile, otherwise show
  // the picker.
  useEffect(() => {
    if (activeProfileId !== null) return
    void invoke('profiles:list', undefined).then((profiles) => {
      if (profiles.length === 1 && profiles[0] && !profiles[0].hasPin) {
        setActiveProfile(profiles[0].id)
      } else {
        navigate('/profiles')
      }
    })
  }, [activeProfileId, setActiveProfile, navigate])

  return (
    <div className="relative flex h-full bg-surface">
      <WindowDragBar />
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-white/5 bg-surface-raised p-3">
        {/* pt-8 clears the native traffic lights (titleBarStyle:'hidden'). */}
        <div className="mb-4 px-2 pt-8 text-lg font-semibold tracking-tight text-white">
          Bitesized IPTV Player
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent/15 text-accent-hover'
                  : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-100'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => {
            setActiveProfile(null)
            navigate('/profiles')
          }}
          className="mt-auto rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
        >
          Switch profile
        </button>
      </nav>
      {/* The WindowDragBar overlays the top 32px of the window. Reserving the
          same height here keeps every screen's content — and its click targets —
          out from under that drag region, instead of each screen opting out of
          dragging piecemeal. */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-8 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
      <SyncProgressToast />
    </div>
  )
}

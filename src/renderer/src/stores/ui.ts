import { create } from 'zustand'
import type { CategorySelection } from '../components/CategorySidebar'
import { applyAccent, DEFAULT_ACCENT } from '../lib/accent'

/** Browse screens that carry a category sidebar. */
export type BrowseKind = 'live' | 'vod' | 'series'

interface UiState {
  /** Active profile; null until a profile is picked. */
  activeProfileId: number | null
  /** Provider scope for browse screens; null = all providers. */
  activeProviderId: number | null
  /**
   * Last-selected category per browse screen. Lives here (not in each screen's
   * local state) so it survives the unmount/remount cycle when you open a
   * stream and navigate back — returning you to the category you were in.
   */
  browseCategory: Record<BrowseKind, CategorySelection>
  /**
   * Last search query. Lives here (not in Search's local state) so it survives
   * the unmount/remount cycle when you open a result and navigate back —
   * returning you to your search instead of a blank box.
   */
  searchTerm: string
  /** Chosen accent theme id (see lib/accent.ts); persisted via the settings IPC. */
  accentTheme: string
  setActiveProfile: (id: number | null) => void
  setActiveProvider: (id: number | null) => void
  setBrowseCategory: (kind: BrowseKind, id: CategorySelection) => void
  setSearchTerm: (term: string) => void
  /** Set + live-apply the accent theme. Persistence is the caller's job. */
  setAccentTheme: (id: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeProfileId: null,
  activeProviderId: null,
  browseCategory: { live: 'all', vod: 'all', series: 'all' },
  searchTerm: '',
  accentTheme: DEFAULT_ACCENT,
  setActiveProfile: (id) => set({ activeProfileId: id }),
  setActiveProvider: (id) => set({ activeProviderId: id }),
  setBrowseCategory: (kind, id) =>
    set((state) => ({ browseCategory: { ...state.browseCategory, [kind]: id } })),
  setSearchTerm: (term) => set({ searchTerm: term }),
  setAccentTheme: (id) => {
    applyAccent(id)
    set({ accentTheme: id })
  }
}))

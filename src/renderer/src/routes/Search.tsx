import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Channel, ContentKind, Series, VodItem } from '@shared/types'
import type { SearchFilters } from '../lib/catalog'
import { useCategories, useSearch } from '../lib/catalog'
import { useFlatPages } from '../lib/browseHelpers'
import { useUiStore } from '../stores/ui'

const QUALITIES = ['4K', '1080p', '720p', 'SD'] as const

type SearchRow = Channel | VodItem | Series

interface ResultGroup {
  categoryId: number | null
  label: string
  items: SearchRow[]
}

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

/**
 * Bucket hits under their category so results read like the browse view. Groups
 * keep bm25 order — a category appears where its best-ranked hit does, and rows
 * keep their rank within it.
 */
function groupByCategory(items: SearchRow[], names: Map<number, string>): ResultGroup[] {
  const groups = new Map<number | 'none', ResultGroup>()
  for (const item of items) {
    const key = item.categoryId ?? 'none'
    let group = groups.get(key)
    if (!group) {
      group = {
        categoryId: item.categoryId,
        label: item.categoryId === null ? 'Uncategorized' : (names.get(item.categoryId) ?? 'Other'),
        items: []
      }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}

/** Right-pointing chevron for the "browse this category" secondary action. */
function JumpIcon(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function SearchSection({
  title,
  kind,
  term,
  filters,
  onOpen,
  onBrowseCategory
}: {
  title: string
  kind: ContentKind
  term: string
  filters?: SearchFilters
  onOpen: (kind: ContentKind, id: number) => void
  onBrowseCategory: (kind: ContentKind, categoryId: number) => void
}): JSX.Element | null {
  const query = useSearch(term, kind, filters)
  const items = useFlatPages(query) as SearchRow[]
  const { data: categories } = useCategories(kind)
  const categoryNames = useMemo(
    () => new Map((categories ?? []).map((c) => [c.id, c.name])),
    [categories]
  )
  const groups = useMemo(() => groupByCategory(items, categoryNames), [items, categoryNames])

  if (term.trim().length < 2 || (items.length === 0 && !query.isLoading)) return null

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {groups.map((group) => (
        <div key={group.categoryId ?? 'none'} className="mb-3">
          {/* The heading doubles as a way into the whole category, so a search
              can be an entry point to browsing, not just to one title. */}
          {group.categoryId !== null ? (
            <button
              type="button"
              onClick={() => onBrowseCategory(kind, group.categoryId!)}
              title={`Browse ${group.label}`}
              className="group mb-1 flex items-center gap-1 px-3 text-xs font-medium text-neutral-500 hover:text-accent-hover"
            >
              <span className="truncate">{group.label}</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <JumpIcon />
              </span>
            </button>
          ) : (
            <div className="mb-1 px-3 text-xs font-medium text-neutral-600">{group.label}</div>
          )}
          <div className="flex flex-col">
            {group.items.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-1 rounded-md pr-2 hover:bg-white/5"
              >
                <button
                  type="button"
                  onClick={() => onOpen(kind, item.id)}
                  className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-neutral-200"
                >
                  {item.name}
                </button>
                {item.categoryId !== null ? (
                  <button
                    type="button"
                    aria-label={`Go to ${group.label}`}
                    title={`Go to ${group.label}`}
                    onClick={() => onBrowseCategory(kind, item.categoryId!)}
                    className="shrink-0 rounded p-1 text-neutral-600 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100"
                  >
                    <JumpIcon />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          className="mt-1 px-3 text-xs text-accent-hover hover:underline"
        >
          Show more
        </button>
      ) : null}
    </section>
  )
}

export function SearchScreen(): JSX.Element {
  const navigate = useNavigate()
  // Persisted in the ui store so opening a result and coming back restores the
  // query instead of clearing it.
  const input = useUiStore((s) => s.searchTerm)
  const setInput = useUiStore((s) => s.setSearchTerm)
  const setBrowseCategory = useUiStore((s) => s.setBrowseCategory)
  const term = useDebounced(input, 250)
  const [quality, setQuality] = useState('')
  const [year, setYear] = useState('')
  const [genre, setGenre] = useState('')

  const open = (kind: ContentKind, id: number): void => {
    if (kind === 'live') navigate(`/player/live/${id}`)
    else if (kind === 'vod') navigate(`/vod/${id}`)
    else navigate(`/series/${id}`)
  }

  // Open the browse screen for this kind, scoped to the result's category. The
  // selection lives in the ui store, which is what those screens read.
  const browseCategory = (kind: ContentKind, categoryId: number): void => {
    setBrowseCategory(kind, categoryId)
    navigate(kind === 'live' ? '/live' : kind === 'vod' ? '/vod' : '/series')
  }

  const yearNum = /^\d{4}$/.test(year) ? Number(year) : undefined
  const vodFilters: SearchFilters = {
    ...(quality ? { quality } : {}),
    ...(yearNum !== undefined ? { year: yearNum } : {})
  }
  const seriesFilters: SearchFilters = genre.trim() ? { genre: genre.trim() } : {}

  const fieldClass =
    'rounded-lg border border-white/10 bg-surface-raised px-3 py-1.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-accent'

  return (
    <div className="mx-auto max-w-3xl p-8">
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search channels, movies and series…"
        className="mb-3 w-full rounded-lg border border-white/10 bg-surface-raised px-4 py-3 text-base text-white placeholder-neutral-500 outline-none focus:border-accent"
      />
      {/* Filters combine with the FTS term: quality/year narrow Movies, genre
          narrows Series. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          aria-label="Quality"
          className={fieldClass}
        >
          <option value="">Any quality</option>
          {QUALITIES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="Year"
          aria-label="Year"
          className={`${fieldClass} w-24`}
        />
        <input
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="Genre (series)"
          aria-label="Genre"
          className={`${fieldClass} w-40`}
        />
      </div>
      {term.trim().length < 2 ? (
        <p className="text-sm text-neutral-500">Type at least two characters to search.</p>
      ) : (
        <>
          <SearchSection
            title="Live TV"
            kind="live"
            term={term}
            onOpen={open}
            onBrowseCategory={browseCategory}
          />
          <SearchSection
            title="Movies"
            kind="vod"
            term={term}
            filters={vodFilters}
            onOpen={open}
            onBrowseCategory={browseCategory}
          />
          <SearchSection
            title="Series"
            kind="series"
            term={term}
            filters={seriesFilters}
            onOpen={open}
            onBrowseCategory={browseCategory}
          />
        </>
      )}
    </div>
  )
}

// The favourites library: every favourite grouped by broad type (Live TV /
// Movies / Series) and, inside each type, by its provider category. The
// left-hand tree doubles as a filter and as a way into browsing the
// underlying category.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ContentKind, FavoriteEntry } from '@shared/types'
import { FavoriteButton } from '../components/FavoriteButton'
import { useDetailedFavorites } from '../lib/catalog'
import { useUiStore } from '../stores/ui'

const KINDS: { kind: ContentKind; label: string }[] = [
  { kind: 'live', label: 'Live TV' },
  { kind: 'vod', label: 'Movies' },
  { kind: 'series', label: 'Series' }
]

/** A category bucket inside one type. `categoryId` is null for uncategorized. */
interface CategoryGroup {
  categoryId: number | null
  label: string
  items: FavoriteEntry[]
}

interface KindGroup {
  kind: ContentKind
  label: string
  count: number
  categories: CategoryGroup[]
}

/** null categoryId = the whole type; null kind = everything. */
interface Selection {
  kind: ContentKind | null
  categoryId: number | null
  /** Distinguishes "the uncategorized bucket" from "the whole type". */
  uncategorized?: boolean
}

const ALL: Selection = { kind: null, categoryId: null }

function groupFavorites(entries: FavoriteEntry[]): KindGroup[] {
  return KINDS.map(({ kind, label }) => {
    const items = entries.filter((e) => e.itemType === kind)
    const categories = new Map<number | 'none', CategoryGroup>()
    for (const item of items) {
      const key = item.categoryId ?? 'none'
      let group = categories.get(key)
      if (!group) {
        group = {
          categoryId: item.categoryId,
          label: item.categoryName ?? 'Uncategorized',
          items: []
        }
        categories.set(key, group)
      }
      group.items.push(item)
    }
    return { kind, label, count: items.length, categories: [...categories.values()] }
  }).filter((group) => group.count > 0)
}

function matches(selection: Selection, kind: ContentKind, categoryId: number | null): boolean {
  if (selection.kind === null) return true
  if (selection.kind !== kind) return false
  if (selection.uncategorized) return categoryId === null
  if (selection.categoryId === null) return true
  return selection.categoryId === categoryId
}

function FavoriteCard({
  entry,
  onOpen
}: {
  entry: FavoriteEntry
  onOpen: () => void
}): JSX.Element {
  // Channel logos are wide, posters are tall — keep each in its natural shape.
  const wide = entry.itemType === 'live'
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className={`${wide ? 'w-40' : 'w-32'} text-left transition-transform hover:scale-[1.03]`}
      >
        <span
          className={`flex ${wide ? 'aspect-video' : 'aspect-[2/3]'} w-full items-center justify-center overflow-hidden rounded-lg bg-surface-overlay`}
        >
          {entry.image ? (
            <img
              src={entry.image}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-neutral-300">{entry.name}</span>
      </button>
      <span className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
        <FavoriteButton itemType={entry.itemType} itemId={entry.itemId} favorited />
      </span>
    </div>
  )
}

export function FavoritesScreen(): JSX.Element {
  const navigate = useNavigate()
  const setBrowseCategory = useUiStore((s) => s.setBrowseCategory)
  const [selection, setSelection] = useState<Selection>(ALL)
  const { data, isLoading } = useDetailedFavorites()
  const groups = useMemo(() => groupFavorites(data ?? []), [data])

  const open = (entry: FavoriteEntry): void => {
    if (entry.itemType === 'live') navigate(`/player/live/${entry.itemId}`)
    else if (entry.itemType === 'vod') navigate(`/vod/${entry.itemId}`)
    else navigate(`/series/${entry.itemId}`)
  }

  // Same affordance as the search results: a favourite's category is also a way
  // into browsing that whole category.
  const browseCategory = (kind: ContentKind, categoryId: number): void => {
    setBrowseCategory(kind, categoryId)
    navigate(kind === 'live' ? '/live' : kind === 'vod' ? '/vod' : '/series')
  }

  const navButton = (active: boolean): string =>
    `flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
      active
        ? 'bg-accent/15 text-accent-hover'
        : 'text-neutral-400 hover:bg-white/5 hover:text-white'
    }`

  const visible = groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((c) => matches(selection, group.kind, c.categoryId))
    }))
    .filter((group) => group.categories.length > 0)

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-white/5 p-2">
        <button
          type="button"
          onClick={() => setSelection(ALL)}
          className={navButton(selection.kind === null)}
        >
          <span className="truncate">All favourites</span>
          <span className="shrink-0 text-xs text-neutral-600">{data?.length ?? ''}</span>
        </button>
        {groups.map((group) => (
          <div key={group.kind} className="mt-2">
            <button
              type="button"
              onClick={() => setSelection({ kind: group.kind, categoryId: null })}
              className={navButton(
                selection.kind === group.kind &&
                  selection.categoryId === null &&
                  !selection.uncategorized
              )}
            >
              <span className="truncate font-medium">{group.label}</span>
              <span className="shrink-0 text-xs text-neutral-600">{group.count}</span>
            </button>
            {group.categories.map((category) => (
              <button
                key={category.categoryId ?? 'none'}
                type="button"
                onClick={() =>
                  setSelection({
                    kind: group.kind,
                    categoryId: category.categoryId,
                    uncategorized: category.categoryId === null
                  })
                }
                className={`${navButton(
                  selection.kind === group.kind &&
                    (category.categoryId === null
                      ? selection.uncategorized === true
                      : selection.categoryId === category.categoryId)
                )} pl-6 text-xs`}
              >
                <span className="truncate">{category.label}</span>
                <span className="shrink-0 text-xs text-neutral-600">{category.items.length}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {isLoading ? null : visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            No favourites yet — add some with the heart on any channel, movie or series.
          </div>
        ) : (
          visible.map((group) => (
            <section key={group.kind} className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white">{group.label}</h2>
              {group.categories.map((category) => (
                <div key={category.categoryId ?? 'none'} className="mb-5">
                  {category.categoryId !== null ? (
                    <button
                      type="button"
                      onClick={() => browseCategory(group.kind, category.categoryId!)}
                      title={`Browse ${category.label}`}
                      className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-accent-hover"
                    >
                      {category.label}
                    </button>
                  ) : (
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                      {category.label}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {category.items.map((entry) => (
                      <FavoriteCard
                        key={`${entry.itemType}:${entry.itemId}`}
                        entry={entry}
                        onOpen={() => open(entry)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

import { Fragment, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Category } from '@shared/types'
import { invoke } from '../lib/api'
import { useUiStore } from '../stores/ui'

export type CategorySelection = number | 'all' | 'favorites' | 'recent' | 'uncategorized'

const virtualEntries: { id: CategorySelection; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recently Added' },
  { id: 'uncategorized', label: 'Uncategorized' }
]

function EyeIcon({ off }: { off: boolean }): JSX.Element {
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
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="m3 3 18 18" /> : null}
    </svg>
  )
}

function GripIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  )
}

/** Insertion marker shown between rows while dragging in edit mode. */
function DropLine(): JSX.Element {
  return (
    <div
      data-testid="category-drop-indicator"
      aria-hidden
      className="mx-1.5 my-0.5 h-0.5 shrink-0 rounded-full bg-accent"
    />
  )
}

export function CategorySidebar({
  categories,
  selected,
  onSelect
}: {
  categories: Category[] | undefined
  selected: CategorySelection
  onSelect: (id: CategorySelection) => void
}): JSX.Element {
  const profileId = useUiStore((s) => s.activeProfileId)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  // Working copy for drag reordering; kept in sync with the server list by id
  // signature so a refetch (or category switch) refreshes it without clobbering
  // an in-progress drag.
  const [order, setOrder] = useState<Category[]>(categories ?? [])
  const [dragId, setDragId] = useState<number | null>(null)
  // Where a drop would land: the row being hovered and which side of it. Drives
  // the insertion line so the move is visible *before* the release.
  const [dropAt, setDropAt] = useState<{ id: number; before: boolean } | null>(null)
  const idSignature = (categories ?? []).map((c) => c.id).join(',')

  useEffect(() => {
    setOrder(categories ?? [])
  }, [idSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['catalog', 'categories'] })

  /** Flip one category's `hidden` flag in every cached category list. */
  const patchHidden = (categoryId: number, hidden: boolean): void => {
    // Category ids are unique across kinds, so patching by id is safe to apply
    // to every cached list (live/vod/series) at once.
    queryClient.setQueriesData<Category[]>({ queryKey: ['catalog', 'categories'] }, (cur) =>
      cur?.map((c) => (c.id === categoryId ? { ...c, hidden } : c))
    )
    setOrder((cur) => cur.map((c) => (c.id === categoryId ? { ...c, hidden } : c)))
  }

  const setHidden = useMutation({
    mutationFn: (vars: { categoryId: number; hidden: boolean }) =>
      invoke('categories:setHidden', { profileId: profileId!, ...vars }),
    // Apply the toggle immediately. Waiting for the write → invalidate → refetch
    // round-trip made the eye feel unresponsive; the refetch in
    // onSettled still reconciles with what the DB actually stored.
    onMutate: async (vars) => {
      // Stop an in-flight categories refetch from landing on top of the
      // optimistic value with pre-toggle data.
      await queryClient.cancelQueries({ queryKey: ['catalog', 'categories'] })
      patchHidden(vars.categoryId, vars.hidden)
    },
    onError: (_error, vars) => patchHidden(vars.categoryId, !vars.hidden),
    onSettled: invalidate
  })
  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) =>
      invoke('categories:reorder', { profileId: profileId!, orderedIds }),
    onSuccess: invalidate
  })

  const buttonClass = (active: boolean): string =>
    `flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
      active
        ? 'bg-accent/15 text-accent-hover'
        : 'text-neutral-400 hover:bg-white/5 hover:text-white'
    }`

  const canEdit = profileId !== null && (categories?.length ?? 0) > 0
  // Normal mode hides hidden categories; edit mode shows all so they can be
  // toggled back on.
  const visible = editing ? order : (categories ?? []).filter((c) => !c.hidden)

  /** Which side of `targetId` the pointer is on, from the row's midpoint. */
  const handleDragOver = (event: React.DragEvent, targetId: number): void => {
    event.preventDefault()
    if (dragId === null || dragId === targetId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    setDropAt((cur) =>
      cur?.id === targetId && cur.before === before ? cur : { id: targetId, before }
    )
  }

  const endDrag = (): void => {
    setDragId(null)
    setDropAt(null)
  }

  const handleDrop = (): void => {
    const target = dropAt
    if (dragId === null || target === null || dragId === target.id) {
      endDrag()
      return
    }
    const next = [...order]
    const from = next.findIndex((c) => c.id === dragId)
    if (from === -1) {
      endDrag()
      return
    }
    const [moved] = next.splice(from, 1)
    // Index is resolved *after* the removal, so it already accounts for the
    // dragged row leaving its old slot.
    const targetIndex = next.findIndex((c) => c.id === target.id)
    if (targetIndex === -1) {
      endDrag()
      return
    }
    next.splice(target.before ? targetIndex : targetIndex + 1, 0, moved!)
    setOrder(next)
    endDrag()
    reorder.mutate(next.map((c) => c.id))
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-white/5 p-2">
      {virtualEntries.map((entry) => (
        <button
          key={String(entry.id)}
          type="button"
          onClick={() => onSelect(entry.id)}
          className={buttonClass(selected === entry.id)}
        >
          <span className="truncate">{entry.label}</span>
        </button>
      ))}

      {canEdit ? (
        <div className="mx-1 mt-2 flex items-center justify-between">
          <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            Categories
          </span>
          <button
            type="button"
            onClick={() => {
              setEditing((e) => !e)
              endDrag()
            }}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:bg-white/5 hover:text-white"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      ) : (
        <div className="mx-3 my-2 border-t border-white/5" />
      )}

      {visible.map((cat) =>
        editing ? (
          <Fragment key={cat.id}>
            {dropAt?.id === cat.id && dropAt.before ? <DropLine /> : null}
            <div
              draggable
              onDragStart={() => setDragId(cat.id)}
              onDragOver={(e) => handleDragOver(e, cat.id)}
              onDragEnd={endDrag}
              onDrop={handleDrop}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-sm ${
                dragId === cat.id ? 'opacity-50' : ''
              } ${cat.hidden ? 'text-neutral-600' : 'text-neutral-300'}`}
            >
              <span className="cursor-grab text-neutral-600" aria-hidden>
                <GripIcon />
              </span>
              <span className="min-w-0 flex-1 truncate">{cat.name}</span>
              <button
                type="button"
                aria-label={cat.hidden ? `Show ${cat.name}` : `Hide ${cat.name}`}
                title={cat.hidden ? 'Show' : 'Hide'}
                onClick={() => setHidden.mutate({ categoryId: cat.id, hidden: !cat.hidden })}
                className="shrink-0 rounded p-1 text-neutral-500 hover:bg-white/10 hover:text-white"
              >
                <EyeIcon off={!!cat.hidden} />
              </button>
            </div>
            {dropAt?.id === cat.id && !dropAt.before ? <DropLine /> : null}
          </Fragment>
        ) : (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelect(cat.id)}
            className={buttonClass(selected === cat.id)}
          >
            <span className="truncate">{cat.name}</span>
            <span className="ml-2 shrink-0 text-xs text-neutral-600">{cat.itemCount ?? ''}</span>
          </button>
        )
      )}
    </aside>
  )
}

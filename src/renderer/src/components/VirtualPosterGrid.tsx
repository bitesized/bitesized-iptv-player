import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FOCUS_INDEX_ATTR, useVirtualFocus } from '../lib/virtualFocus'

const CARD_WIDTH = 150
const CARD_HEIGHT = 260
const GAP = 12

/**
 * Windowed poster grid: only visible rows are mounted, so 100k-item catalogs
 * scroll smoothly. Calls onEndReached as the last rows come into view.
 */
export function VirtualPosterGrid<T>({
  items,
  renderCard,
  onEndReached,
  hasMore
}: {
  items: T[]
  renderCard: (item: T) => React.ReactNode
  onEndReached: () => void
  hasMore: boolean
}): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(6)

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const update = (): void => {
      const width = el.clientWidth - 32
      setColumns(Math.max(2, Math.floor(width / (CARD_WIDTH + GAP))))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rowCount = Math.ceil(items.length / columns)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 4
  })

  const virtualRows = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualRows.at(-1)
    if (last && hasMore && last.index >= rowCount - 3) {
      onEndReached()
    }
  }, [virtualRows, rowCount, hasMore, onEndReached])

  // D-pad navigation across the grid: left/right within a row, up/down by a
  // whole row. Each card wraps in a `display: contents` marker so the wrapper
  // adds no layout box and focus still lands on the card's own button.
  const { indexFromEvent, focusIndex } = useVirtualFocus(parentRef)
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    const current = indexFromEvent(event)
    if (current === null) return
    const page =
      Math.max(1, Math.floor((parentRef.current?.clientHeight ?? 0) / (CARD_HEIGHT + GAP))) *
      columns
    const next = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      ArrowDown: current + columns,
      ArrowUp: current - columns,
      PageDown: current + page,
      PageUp: current - page,
      Home: 0,
      End: items.length - 1
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const clamped = Math.max(0, Math.min(items.length - 1, next))
    virtualizer.scrollToIndex(Math.floor(clamped / columns))
    focusIndex(clamped)
  }

  return (
    <div
      ref={parentRef}
      onKeyDown={handleKeyDown}
      className="h-full flex-1 overflow-y-auto px-4 py-3"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            className="absolute left-0 top-0 grid w-full"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: GAP
            }}
          >
            {items.slice(row.index * columns, row.index * columns + columns).map((item, column) => (
              <div
                key={row.index * columns + column}
                {...{ [FOCUS_INDEX_ATTR]: row.index * columns + column }}
                style={{ display: 'contents' }}
              >
                {renderCard(item)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

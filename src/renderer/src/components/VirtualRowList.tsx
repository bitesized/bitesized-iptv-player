import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FOCUS_INDEX_ATTR, useVirtualFocus } from '../lib/virtualFocus'

const DEFAULT_ROW_HEIGHT = 56

/** Windowed flat list used for channel lists and search results. */
export function VirtualRowList<T>({
  items,
  renderRow,
  onEndReached,
  hasMore,
  rowHeight = DEFAULT_ROW_HEIGHT
}: {
  items: T[]
  renderRow: (item: T) => React.ReactNode
  onEndReached: () => void
  hasMore: boolean
  /** Fixed row height in px (uniform — the list is windowed). */
  rowHeight?: number
}): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10
  })

  const virtualRows = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualRows.at(-1)
    if (last && hasMore && last.index >= items.length - 15) {
      onEndReached()
    }
  }, [virtualRows, items.length, hasMore, onEndReached])

  // Arrow / Page / Home / End move focus between rows (D-pad friendly). Enter
  // and Space are left alone: focus lands on the row's own button, so they
  // already activate it.
  const { indexFromEvent, focusIndex } = useVirtualFocus(parentRef)
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    const current = indexFromEvent(event)
    if (current === null) return
    const page = Math.max(1, Math.floor((parentRef.current?.clientHeight ?? 0) / rowHeight) - 1)
    const next = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      PageDown: current + page,
      PageUp: current - page,
      Home: 0,
      End: items.length - 1
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const clamped = Math.max(0, Math.min(items.length - 1, next))
    virtualizer.scrollToIndex(clamped)
    focusIndex(clamped)
  }

  return (
    <div ref={parentRef} onKeyDown={handleKeyDown} className="h-full flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            {...{ [FOCUS_INDEX_ATTR]: row.index }}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${row.start}px)`, height: rowHeight }}
          >
            {renderRow(items[row.index]!)}
          </div>
        ))}
      </div>
    </div>
  )
}

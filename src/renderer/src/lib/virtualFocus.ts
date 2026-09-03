// Keyboard/remote focus plumbing for the windowed list and grid: a
// keyboard-navigable, remote-friendly focus model.
//
// The windowed views only mount the rows around the viewport, so "move focus to
// item N" can't just call focus(): N may not exist in the DOM yet. Callers scroll
// the virtualizer to N and hand the index here; the effect below focuses it as
// soon as it mounts (retrying across renders until it does).

import { useEffect, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

/** Elements a D-pad / Tab should be able to land on. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Marks the element that owns item `index` (set by the virtualized views). */
export const FOCUS_INDEX_ATTR = 'data-focus-index'

export interface VirtualFocus {
  /** Which item the currently focused element belongs to, or null. */
  indexFromEvent: (event: KeyboardEvent) => number | null
  /** Focus item `index` once the virtualizer has it mounted. */
  focusIndex: (index: number) => void
}

export function useVirtualFocus(containerRef: RefObject<HTMLElement | null>): VirtualFocus {
  const [pending, setPending] = useState<number | null>(null)

  useEffect(() => {
    if (pending === null) return
    const owner = containerRef.current?.querySelector<HTMLElement>(
      `[${FOCUS_INDEX_ATTR}="${pending}"]`
    )
    // Not mounted yet — a later render (the scroll the caller kicked off) retries.
    if (!owner) return
    const target = owner.matches(FOCUSABLE) ? owner : owner.querySelector<HTMLElement>(FOCUSABLE)
    setPending(null)
    target?.focus({ preventScroll: true })
  }, [pending, containerRef])

  return {
    indexFromEvent: (event) => {
      const owner = (event.target as HTMLElement).closest(`[${FOCUS_INDEX_ATTR}]`)
      const raw = owner?.getAttribute(FOCUS_INDEX_ATTR)
      const index = raw === null || raw === undefined ? Number.NaN : Number(raw)
      return Number.isNaN(index) ? null : index
    },
    focusIndex: setPending
  }
}

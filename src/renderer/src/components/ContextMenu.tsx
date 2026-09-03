import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  /** Optional destructive styling (red). */
  danger?: boolean
}

/** Open position for the menu, or null when closed. */
export type ContextMenuState = { x: number; y: number } | null

/**
 * Manages open/close + anchor position for a right-click menu. Returns an
 * `onContextMenu` handler to spread onto the target, the current position
 * (null when closed), and a `close` callback.
 */
export function useContextMenu(): {
  menu: ContextMenuState
  onContextMenu: (e: React.MouseEvent) => void
  close: () => void
} {
  const [menu, setMenu] = useState<ContextMenuState>(null)
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  return { menu, onContextMenu, close }
}

/**
 * A positioned popover of actions. Rendered in a portal so it escapes any
 * `overflow:hidden` ancestor; closes on outside-click, Escape, scroll, or
 * resize. No native menu (the sandboxed renderer has no `remote`).
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Dismiss on a pointerdown outside the menu. Containment check (not
    // stopPropagation) is essential: this is a capture-phase listener that
    // fires before the item's click, so closing unconditionally would unmount
    // the item before its onClick runs.
    const onPointerDown = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const close = (): void => onClose()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  // Keep the menu inside the viewport (rough estimate; flips near edges).
  const MENU_WIDTH = 200
  const ITEM_HEIGHT = 34
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - items.length * ITEM_HEIGHT - 8)

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-white/10 bg-surface-overlay py-1 shadow-xl"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={(e) => {
            // The menu is portaled, but React events still bubble through the
            // component tree to the card that opened it — stop that so choosing
            // an action doesn't also trigger the card's onClick (navigation).
            e.stopPropagation()
            item.onSelect()
            onClose()
          }}
          className={`block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/10 ${
            item.danger ? 'text-red-400' : 'text-neutral-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

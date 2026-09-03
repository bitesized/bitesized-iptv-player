// Keyboard / remote focus model: the windowed list and grid
// must be navigable with a D-pad's worth of keys, moving focus onto the item's
// own control so Enter activates it.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VirtualRowList } from '@renderer/components/VirtualRowList'
import { VirtualPosterGrid } from '@renderer/components/VirtualPosterGrid'

const items = Array.from({ length: 12 }, (_, i) => `Item ${i}`)

afterEach(() => cleanup())

function focusedLabel(): string | null {
  return document.activeElement?.textContent ?? null
}

describe('VirtualRowList keyboard navigation', () => {
  it('moves focus between rows with the arrow keys and Home/End', async () => {
    render(
      <VirtualRowList
        items={items}
        rowHeight={40}
        hasMore={false}
        onEndReached={() => {}}
        renderRow={(item) => (
          <button type="button" onClick={() => {}}>
            {item}
          </button>
        )}
      />
    )

    const first = await screen.findByText('Item 0')
    first.focus()
    expect(focusedLabel()).toBe('Item 0')

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(focusedLabel()).toBe('Item 1')

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(focusedLabel()).toBe('Item 2')

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(focusedLabel()).toBe('Item 1')

    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(focusedLabel()).toBe('Item 0')

    // Clamped at the ends rather than wrapping or running off the list.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(focusedLabel()).toBe('Item 0')
  })

  it('ignores keys it does not handle', async () => {
    render(
      <VirtualRowList
        items={items}
        rowHeight={40}
        hasMore={false}
        onEndReached={() => {}}
        renderRow={(item) => <button type="button">{item}</button>}
      />
    )
    const first = await screen.findByText('Item 0')
    first.focus()
    fireEvent.keyDown(first, { key: 'a' })
    expect(focusedLabel()).toBe('Item 0')
  })
})

describe('VirtualPosterGrid keyboard navigation', () => {
  it('steps within a row and by a whole row', async () => {
    render(
      <VirtualPosterGrid
        items={items}
        hasMore={false}
        onEndReached={() => {}}
        renderCard={(item) => (
          <button type="button" key={item}>
            {item}
          </button>
        )}
      />
    )

    const first = await screen.findByText('Item 0')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(focusedLabel()).toBe('Item 1')

    // jsdom reports zero width, so the grid falls back to its minimum of two
    // columns — one row down from index 1 is index 3.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(focusedLabel()).toBe('Item 3')

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(focusedLabel()).toBe('Item 2')

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(focusedLabel()).toBe('Item 11')
  })
})

// Edit mode for the category sidebar: hide/unhide + drag reorder, per profile.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Category } from '@shared/types'
import { CategorySidebar } from '@renderer/components/CategorySidebar'
import { useUiStore } from '@renderer/stores/ui'
import { mockChannel, resetMockApi } from './mockApi'

function renderSidebar(categories: Category[]): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <CategorySidebar categories={categories} selected="all" onSelect={() => {}} />
    </QueryClientProvider>
  )
}

const cat = (id: number, name: string, hidden = false): Category => ({
  id,
  providerId: 1,
  kind: 'live',
  remoteId: `r${id}`,
  name,
  itemCount: 1,
  hidden,
  position: null
})

/** jsdom has no layout, so rows need a rect for the midpoint hit test. */
function stubRect(el: Element, top: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect
}

/**
 * jsdom has no `DragEvent`, so fireEvent.dragOver falls back to a plain `Event`
 * and drops `clientY`. A `MouseEvent` named "dragover" carries the coordinate
 * React's synthetic drag event reads.
 */
function dragOverAt(el: Element, clientY: number): void {
  fireEvent(el, new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY }))
}

beforeEach(() => {
  resetMockApi()
  useUiStore.setState({ activeProfileId: 1 })
})
afterEach(() => cleanup())

describe('CategorySidebar edit mode', () => {
  it('hides hidden categories in normal mode but shows them in edit mode', () => {
    renderSidebar([cat(1, 'Sports'), cat(2, 'Anime', true)])
    // Normal mode: the hidden category is not listed.
    expect(screen.getByText('Sports')).toBeTruthy()
    expect(screen.queryByText('Anime')).toBeNull()

    fireEvent.click(screen.getByText('Edit'))
    // Edit mode reveals it with a Show toggle.
    expect(screen.getByText('Anime')).toBeTruthy()
    expect(screen.getByLabelText('Show Anime')).toBeTruthy()
    expect(screen.getByLabelText('Hide Sports')).toBeTruthy()
  })

  it('toggling the eye calls categories:setHidden for the active profile', async () => {
    const calls: { categoryId: number; hidden: boolean; profileId: number }[] = []
    mockChannel('categories:setHidden', (req) => {
      calls.push(req)
    })
    renderSidebar([cat(1, 'Sports')])
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByLabelText('Hide Sports'))
    await waitFor(() => expect(calls).toEqual([{ profileId: 1, categoryId: 1, hidden: true }]))
  })

  it('toggling the eye flips the icon immediately, before the write resolves', async () => {
    let resolveWrite: (() => void) | undefined
    mockChannel(
      'categories:setHidden',
      () => new Promise<void>((resolve) => (resolveWrite = () => resolve())) as unknown as void
    )
    renderSidebar([cat(1, 'Sports')])
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByLabelText('Hide Sports'))

    // The write is still in flight, yet the row already reads as hidden.
    await waitFor(() => expect(screen.getByLabelText('Show Sports')).toBeTruthy())
    resolveWrite?.()
  })

  it('drag-reordering persists the new order via categories:reorder', async () => {
    const calls: number[][] = []
    mockChannel('categories:reorder', ({ orderedIds }) => {
      calls.push(orderedIds)
    })
    renderSidebar([cat(1, 'Sports'), cat(2, 'Anime'), cat(3, 'Movies')])
    fireEvent.click(screen.getByText('Edit'))

    // Drag "Movies" onto the top half of "Sports" → Movies moves to the front.
    const movies = screen.getByText('Movies').closest('[draggable="true"]')!
    const sports = screen.getByText('Sports').closest('[draggable="true"]')!
    stubRect(sports, 0, 40)
    fireEvent.dragStart(movies)
    dragOverAt(sports, 5)
    // The insertion marker previews the drop before the release.
    expect(screen.getAllByTestId('category-drop-indicator').length).toBe(1)
    fireEvent.drop(sports)

    await waitFor(() => expect(calls).toEqual([[3, 1, 2]]))
    expect(screen.queryByTestId('category-drop-indicator')).toBeNull()
  })

  it('dropping on the lower half of a row inserts after it', async () => {
    const calls: number[][] = []
    mockChannel('categories:reorder', ({ orderedIds }) => {
      calls.push(orderedIds)
    })
    renderSidebar([cat(1, 'Sports'), cat(2, 'Anime'), cat(3, 'Movies')])
    fireEvent.click(screen.getByText('Edit'))

    const movies = screen.getByText('Movies').closest('[draggable="true"]')!
    const sports = screen.getByText('Sports').closest('[draggable="true"]')!
    stubRect(sports, 0, 40)
    fireEvent.dragStart(movies)
    dragOverAt(sports, 35)
    fireEvent.drop(sports)

    await waitFor(() => expect(calls).toEqual([[1, 3, 2]]))
  })
})

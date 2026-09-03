// The accent theme picker (Settings → Appearance) must live-apply the chosen
// accent to the document root and persist it via the settings IPC, and the
// accent helpers must fall back to the default for unknown ids.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { mockChannel, resetMockApi } from './mockApi'
import { SettingsScreen } from '@renderer/routes/Settings'
import { useUiStore } from '@renderer/stores/ui'
import { accentTheme, applyAccent, DEFAULT_ACCENT } from '@renderer/lib/accent'

function renderSettings(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  const router = createMemoryRouter([{ path: '/', element: <SettingsScreen /> }], {
    initialEntries: ['/']
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  resetMockApi()
  useUiStore.setState({ accentTheme: DEFAULT_ACCENT })
  document.documentElement.removeAttribute('style')
})
afterEach(() => cleanup())

describe('accent helpers', () => {
  it('falls back to the default theme for unknown/empty ids', () => {
    expect(accentTheme('nope').id).toBe(DEFAULT_ACCENT)
    expect(accentTheme(null).id).toBe(DEFAULT_ACCENT)
    expect(accentTheme('teal').id).toBe('teal')
  })

  it('applyAccent writes both accent variables onto :root', () => {
    applyAccent('emerald')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--color-accent')).toBe('#10b981')
    expect(root.style.getPropertyValue('--color-accent-hover')).toBe('#34d399')
  })
})

describe('accent picker', () => {
  it('applies and persists the chosen accent', () => {
    const setCalls: { key: string; value: string }[] = []
    mockChannel('settings:set', (payload) => {
      setCalls.push(payload)
    })

    const { getByLabelText } = renderSettings()
    fireEvent.click(getByLabelText('Teal'))

    // Live-applied to the document root...
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#14b8a6')
    // ...reflected in the store...
    expect(useUiStore.getState().accentTheme).toBe('teal')
    // ...and persisted via the settings IPC.
    expect(setCalls).toContainEqual({ key: 'accentTheme', value: 'teal' })
  })
})

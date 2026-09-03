import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { invoke } from './lib/api'
import { useUiStore } from './stores/ui'
import { ACCENT_SETTING_KEY } from './lib/accent'
import './styles/index.css'

// Apply the saved accent theme as early as possible (CSS defaults to Amber until
// this resolves, so a non-default choice may flash once on cold start).
void invoke('settings:get', { key: ACCENT_SETTING_KEY }).then((value) => {
  if (value) useUiStore.getState().setAccentTheme(value)
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
)

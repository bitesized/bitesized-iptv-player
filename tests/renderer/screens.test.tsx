// Render-smoke tests: every screen must mount without throwing, with an empty
// backend and with data. A crash in any of these is exactly what a user sees
// as a black/blank window.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ReactElement } from 'react'
import { mockChannel, resetMockApi } from './mockApi'
import { AppShell } from '@renderer/components/AppShell'
import { HomeScreen } from '@renderer/routes/Home'
import { LiveScreen } from '@renderer/routes/Live'
import { VodScreen } from '@renderer/routes/Vod'
import { VodDetailScreen } from '@renderer/routes/VodDetail'
import { SeriesScreen } from '@renderer/routes/Series'
import { SeriesDetailScreen } from '@renderer/routes/SeriesDetail'
import { FavoritesScreen } from '@renderer/routes/Favorites'
import { GuideScreen } from '@renderer/routes/Guide'
import { SearchScreen } from '@renderer/routes/Search'
import { SettingsScreen } from '@renderer/routes/Settings'
import { OnboardingScreen } from '@renderer/routes/Onboarding'
import { ProfilesScreen } from '@renderer/routes/Profiles'
import { useUiStore } from '@renderer/stores/ui'

function renderRoute(
  element: ReactElement,
  path = '/',
  initialPath = path,
  /** Extra routes the screen can navigate to; each renders its own path as text. */
  otherPaths: string[] = []
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  const router = createMemoryRouter(
    [{ path, element }, ...otherPaths.map((p) => ({ path: p, element: <div>{p}</div> }))],
    { initialEntries: [initialPath] }
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  resetMockApi()
  useUiStore.setState({ activeProfileId: 1, activeProviderId: null })
})

afterEach(() => cleanup())

describe('screens render with an empty backend', () => {
  it('Home shows the welcome state when no providers exist', async () => {
    renderRoute(<HomeScreen />)
    await waitFor(() => expect(screen.getByText(/Add a provider/i)).toBeTruthy())
  })

  it('Live shows the empty channels state', async () => {
    renderRoute(<LiveScreen />)
    await waitFor(() => expect(screen.getByText(/No channels here yet/i)).toBeTruthy())
  })

  it('VOD shows the empty movies state', async () => {
    renderRoute(<VodScreen />)
    await waitFor(() => expect(screen.getByText(/No movies here yet/i)).toBeTruthy())
  })

  it('Series shows the empty series state', async () => {
    renderRoute(<SeriesScreen />)
    await waitFor(() => expect(screen.getByText(/No series here yet/i)).toBeTruthy())
  })

  it('Guide prompts to add a provider', async () => {
    renderRoute(<GuideScreen />)
    await waitFor(() =>
      expect(screen.getByText(/Add a provider to see the TV guide/i)).toBeTruthy()
    )
  })

  it('Search prompts for input', () => {
    renderRoute(<SearchScreen />)
    expect(screen.getByPlaceholderText(/Search channels/i)).toBeTruthy()
  })

  it('Settings shows the empty provider list', async () => {
    renderRoute(<SettingsScreen />)
    await waitFor(() => expect(screen.getByText(/No providers yet/i)).toBeTruthy())
  })

  it('Onboarding shows both provider forms', () => {
    renderRoute(<OnboardingScreen />)
    expect(screen.getByText('Xtream Codes')).toBeTruthy()
    expect(screen.getByText('M3U Playlist')).toBeTruthy()
  })

  it('Profiles shows the picker with the default profile', async () => {
    renderRoute(<ProfilesScreen />)
    await waitFor(() => expect(screen.getByText(/Who's watching/i)).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Default')).toBeTruthy())
  })

  it('AppShell renders navigation and auto-selects the lone profile', async () => {
    useUiStore.setState({ activeProfileId: null })
    renderRoute(<AppShell />)
    expect(screen.getByText('Live TV')).toBeTruthy()
    expect(screen.getByText('TV Guide')).toBeTruthy()
    await waitFor(() => expect(useUiStore.getState().activeProfileId).toBe(1))
  })
})

describe('screens render with data', () => {
  it('Live lists channels with now-playing chips', async () => {
    // The favorites bar issues its own channels:page (categoryId 'favorites');
    // keep it empty so the row list is the only place the channel appears.
    mockChannel('channels:page', (q) =>
      q.categoryId === 'favorites'
        ? { items: [], nextCursor: null }
        : {
            items: [
              {
                id: 1,
                providerId: 1,
                categoryId: 1,
                streamId: '101',
                name: 'Channel One',
                logo: null,
                streamType: 'live',
                tvArchive: true,
                epgChannelId: 'one.uk',
                num: 1,
                addedAt: null
              }
            ],
            nextCursor: null
          }
    )
    mockChannel('categories:list', () => [
      { id: 1, providerId: 1, kind: 'live', remoteId: 'r1', name: 'News', itemCount: 1 }
    ])
    mockChannel('epg:nowNext', () => [
      {
        channelId: 1,
        now: {
          id: 1,
          epgChannelId: 'one.uk',
          start: Math.floor(Date.now() / 1000) - 60,
          stop: Math.floor(Date.now() / 1000) + 60,
          title: 'Evening News',
          description: null,
          category: null
        },
        next: null
      }
    ])

    renderRoute(<LiveScreen />)
    await waitFor(() => expect(screen.getByText('Channel One')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Evening News')).toBeTruthy())
    expect(screen.getByText('News')).toBeTruthy()
    expect(screen.getByText('CATCH-UP')).toBeTruthy()
  })

  it('Live shows now + next inline and opens a channel schedule pane', async () => {
    const nowSecs = Math.floor(Date.now() / 1000)
    mockChannel('categories:list', () => [
      { id: 1, providerId: 1, kind: 'live', remoteId: 'r1', name: 'News', itemCount: 1 }
    ])
    mockChannel('channels:page', (q) =>
      q.categoryId === 'favorites'
        ? { items: [], nextCursor: null }
        : {
            items: [
              {
                id: 1,
                providerId: 1,
                categoryId: 1,
                streamId: '101',
                name: 'Channel One',
                logo: null,
                streamType: 'live',
                tvArchive: true,
                epgChannelId: 'one.uk',
                num: 1,
                addedAt: null
              }
            ],
            nextCursor: null
          }
    )
    mockChannel('epg:nowNext', () => [
      {
        channelId: 1,
        now: {
          id: 1,
          epgChannelId: 'one.uk',
          start: nowSecs - 60,
          stop: nowSecs + 60,
          title: 'Evening News',
          description: null,
          category: null
        },
        next: {
          id: 2,
          epgChannelId: 'one.uk',
          start: nowSecs + 60,
          stop: nowSecs + 3600,
          title: 'Coming Up Soon',
          description: null,
          category: null
        }
      }
    ])
    mockChannel('epg:window', () => [
      {
        id: 10,
        epgChannelId: 'one.uk',
        start: nowSecs - 7200,
        stop: nowSecs - 3600,
        title: 'Morning Show',
        description: null,
        category: null
      },
      {
        id: 11,
        epgChannelId: 'one.uk',
        start: nowSecs - 60,
        stop: nowSecs + 60,
        title: 'Evening News',
        description: null,
        category: null
      }
    ])

    renderRoute(<LiveScreen />)
    await waitFor(() => expect(screen.getByText('Channel One')).toBeTruthy())
    // The "next" programme is surfaced inline alongside the now-playing one.
    await waitFor(() => expect(screen.getByText(/Coming Up Soon/)).toBeTruthy())

    // Opening the schedule pane lists the channel's programmes; the past one on
    // an archive channel offers catch-up.
    fireEvent.click(screen.getByLabelText('Show schedule'))
    await waitFor(() => expect(screen.getByText('Morning Show')).toBeTruthy())
    expect(screen.getByText('Schedule')).toBeTruthy()
    expect(screen.getByText('Catch-up')).toBeTruthy()
  })

  it('Search restores the query on remount (persisted in the ui store)', () => {
    useUiStore.setState({ searchTerm: '' })
    const first = renderRoute(<SearchScreen />)
    fireEvent.change(screen.getByPlaceholderText(/Search channels/i), {
      target: { value: 'matrix' }
    })
    first.unmount()
    // Re-mounting (as when navigating back from a result) shows the query again.
    renderRoute(<SearchScreen />)
    expect((screen.getByPlaceholderText(/Search channels/i) as HTMLInputElement).value).toBe(
      'matrix'
    )
  })

  it('Favorites groups by type then category, and filters from the sidebar', async () => {
    const fav = (
      itemType: 'live' | 'vod',
      itemId: number,
      name: string,
      categoryId: number | null,
      categoryName: string | null
    ) => ({
      itemType,
      itemId,
      providerId: 1,
      name,
      image: null,
      categoryId,
      categoryName,
      createdAt: 0
    })
    mockChannel('favorites:detailed', () => [
      fav('live', 20, 'Sport One', 1, 'Sports'),
      fav('vod', 10, 'The Matrix', 2, 'Action'),
      fav('vod', 12, 'Loose Movie', null, null)
    ])

    renderRoute(<FavoritesScreen />, '/', '/', ['/vod'])
    await waitFor(() => expect(screen.getByText('Sport One')).toBeTruthy())
    // Both type headings and their category buckets are rendered.
    expect(screen.getAllByText('Live TV').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Movies').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Uncategorized').length).toBeGreaterThan(0)

    // Picking a type in the sidebar narrows the list to that type.
    fireEvent.click(screen.getAllByText('Live TV')[0]!)
    await waitFor(() => expect(screen.queryByText('The Matrix')).toBeNull())
    expect(screen.getByText('Sport One')).toBeTruthy()
  })

  it('Search groups hits by category and jumps into one', async () => {
    useUiStore.setState({
      searchTerm: 'matrix',
      browseCategory: { live: 'all', vod: 'all', series: 'all' }
    })
    mockChannel('categories:list', ({ kind }) =>
      kind === 'vod'
        ? [
            { id: 1, providerId: 1, kind: 'vod', remoteId: 'a', name: 'Action', itemCount: 2 },
            { id: 2, providerId: 1, kind: 'vod', remoteId: 'c', name: 'Classics', itemCount: 1 }
          ]
        : []
    )
    const movie = (id: number, name: string, categoryId: number | null) => ({
      id,
      providerId: 1,
      categoryId,
      streamId: String(id),
      name,
      cover: null,
      rating: null,
      addedAt: null,
      containerExt: null,
      tmdbId: null,
      plot: null,
      durationSecs: null
    })
    mockChannel('search:query', ({ kind }) =>
      kind === 'vod'
        ? {
            items: [
              movie(10, 'The Matrix', 1),
              movie(11, 'Matrix Reloaded', 1),
              movie(12, 'Matrix Revisited', 2)
            ],
            nextCursor: null
          }
        : { items: [], nextCursor: null }
    )

    renderRoute(<SearchScreen />, '/', '/', ['/vod'])
    await waitFor(() => expect(screen.getByText('The Matrix')).toBeTruthy())
    // Hits are bucketed under their category headings, in rank order.
    expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Classics' })).toBeTruthy()
    // Each row also offers the jump as a secondary action.
    expect(screen.getAllByRole('button', { name: 'Go to Action' }).length).toBe(2)

    // The heading is a way into browsing that whole category.
    fireEvent.click(screen.getByRole('button', { name: 'Classics' }))
    await waitFor(() => expect(screen.getByText('/vod')).toBeTruthy())
    expect(useUiStore.getState().browseCategory.vod).toBe(2)
  })

  it('Live shows a favorites bar of favorited channels', async () => {
    mockChannel('categories:list', () => [
      { id: 1, providerId: 1, kind: 'live', remoteId: 'r1', name: 'News', itemCount: 1 }
    ])
    mockChannel('channels:page', (q) => {
      const favChannel = {
        id: 2,
        providerId: 1,
        categoryId: 1,
        streamId: '202',
        name: 'Fav Sports',
        logo: null,
        streamType: 'live',
        tvArchive: false,
        epgChannelId: null,
        num: 2,
        addedAt: null
      }
      // Favorites bar queries the 'favorites' virtual category.
      return q.categoryId === 'favorites'
        ? { items: [favChannel], nextCursor: null }
        : { items: [], nextCursor: null }
    })

    renderRoute(<LiveScreen />)
    // Wait on the favorited channel (unambiguous — the sidebar also has a
    // "Favorites" virtual category).
    await waitFor(() => expect(screen.getByText('Fav Sports')).toBeTruthy())
    // The main list is empty in this fixture, so the empty state still shows.
    expect(screen.getByText(/No channels here yet/i)).toBeTruthy()
    // (The bar clears the WindowDragBar strip because AppShell reserves the top
    // 32px — a native concern jsdom can't observe, so it isn't asserted here.)
  })

  it('VOD detail renders metadata and play button', async () => {
    mockChannel('vod:detail', () => ({
      id: 5,
      providerId: 1,
      categoryId: null,
      streamId: '201',
      name: 'The Matrix',
      cover: null,
      rating: 8.7,
      addedAt: null,
      containerExt: 'mkv',
      tmdbId: null,
      plot: 'A hacker discovers reality.',
      durationSecs: 8160
    }))
    renderRoute(<VodDetailScreen />, '/vod/:id', '/vod/5')
    await waitFor(() => expect(screen.getByText('The Matrix')).toBeTruthy())
    expect(screen.getByText(/Play/)).toBeTruthy()
    expect(screen.getByText(/A hacker discovers reality/)).toBeTruthy()
    expect(screen.getByText(/2h 16m/)).toBeTruthy()
  })

  it('Series detail renders seasons and episodes', async () => {
    mockChannel('series:detail', () => ({
      id: 7,
      providerId: 1,
      categoryId: null,
      seriesId: '301',
      name: 'Breaking Code',
      cover: null,
      plot: null,
      rating: null,
      genre: 'Drama',
      releaseDate: '2020',
      addedAt: null
    }))
    mockChannel('series:episodes', () => [
      {
        id: 1,
        seriesId: 7,
        season: 1,
        episodeNum: 1,
        remoteId: '401',
        title: 'Pilot',
        containerExt: 'mp4',
        durationSecs: 1200,
        plot: null,
        still: null
      },
      {
        id: 2,
        seriesId: 7,
        season: 2,
        episodeNum: 1,
        remoteId: '402',
        title: 'Return',
        containerExt: 'mp4',
        durationSecs: 1200,
        plot: null,
        still: null
      }
    ])
    renderRoute(<SeriesDetailScreen />, '/series/:id', '/series/7')
    await waitFor(() => expect(screen.getByText('Breaking Code')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Season 1')).toBeTruthy())
    expect(screen.getByText('Season 2')).toBeTruthy()
    expect(screen.getByText('Pilot')).toBeTruthy()
  })

  it('Home renders continue-watching and recent rows', async () => {
    mockChannel('providers:list', () => [
      {
        id: 1,
        type: 'xtream',
        name: 'P',
        baseUrl: 'http://x',
        username: 'u',
        m3uUrl: null,
        epgUrl: null,
        hasEpgUrl: false,
        lastSyncAt: null,
        status: 'ok',
        statusMessage: null,
        maxConnections: null
      }
    ])
    mockChannel('history:continueWatching', () => [
      {
        itemType: 'episode',
        itemId: 3,
        name: 'Pilot',
        cover: null,
        positionSecs: 300,
        durationSecs: 1200,
        updatedAt: 0,
        seriesId: 7,
        seriesName: 'Breaking Code',
        season: 1,
        episodeNum: 1
      }
    ])
    mockChannel('vod:page', () => ({
      items: [
        {
          id: 9,
          providerId: 1,
          categoryId: null,
          streamId: '9',
          name: 'Fresh Movie',
          cover: null,
          rating: null,
          addedAt: 1,
          containerExt: null,
          tmdbId: null,
          plot: null,
          durationSecs: null
        }
      ],
      nextCursor: null
    }))
    renderRoute(<HomeScreen />)
    await waitFor(() => expect(screen.getByText(/Continue watching/)).toBeTruthy())
    // Cover-less cards show the name in both the poster placeholder and label.
    expect(screen.getAllByText(/Breaking Code S1E1/).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getAllByText('Fresh Movie').length).toBeGreaterThan(0))
  })

  it('Settings lists providers with status and error message', async () => {
    mockChannel('providers:list', () => [
      {
        id: 1,
        type: 'xtream',
        name: 'Broken Panel',
        baseUrl: 'http://x',
        username: 'u',
        m3uUrl: null,
        epgUrl: null,
        hasEpgUrl: false,
        lastSyncAt: null,
        status: 'error',
        statusMessage: 'Authentication failed',
        maxConnections: null
      }
    ])
    renderRoute(<SettingsScreen />)
    await waitFor(() => expect(screen.getByText('Broken Panel')).toBeTruthy())
    expect(screen.getByText(/Authentication failed/)).toBeTruthy()
    expect(screen.getByText('Re-sync')).toBeTruthy()
  })

  it('Guide renders channel rows and programme blocks', async () => {
    mockChannel('channels:page', () => ({
      items: [
        {
          id: 1,
          providerId: 1,
          categoryId: null,
          streamId: '101',
          name: 'Guide Channel',
          logo: null,
          streamType: 'live',
          tvArchive: false,
          epgChannelId: 'one.uk',
          num: 1,
          addedAt: null
        }
      ],
      nextCursor: null
    }))
    mockChannel('epg:window', () => [
      {
        id: 1,
        epgChannelId: 'one.uk',
        start: Math.floor(Date.now() / 1000) - 600,
        stop: Math.floor(Date.now() / 1000) + 600,
        title: 'Guide Programme',
        description: 'Desc',
        category: null
      }
    ])
    renderRoute(<GuideScreen />)
    await waitFor(() => expect(screen.getByText('Guide Channel')).toBeTruthy())
  })
})

describe('right-click context menus', () => {
  it('opens a VOD poster menu and fires the favorite mutation', async () => {
    let toggled: { itemType: string; itemId: number } | null = null
    mockChannel('favorites:toggle', (input) => {
      toggled = { itemType: input.itemType, itemId: input.itemId }
      return { favorited: true }
    })
    mockChannel('vod:page', () => ({
      items: [
        {
          id: 42,
          providerId: 1,
          categoryId: null,
          streamId: '42',
          name: 'Right Click Movie',
          cover: null,
          rating: null,
          addedAt: 1,
          containerExt: null,
          tmdbId: null,
          plot: null,
          durationSecs: null
        }
      ],
      nextCursor: null
    }))
    renderRoute(<VodScreen />)

    // The poster button carries the movie name; right-click it to open the menu.
    const card = await waitFor(() => screen.getAllByText('Right Click Movie')[0]!)
    fireEvent.contextMenu(card)

    const menuItem = await waitFor(() =>
      screen.getByRole('menuitem', { name: /Add to favorites/i })
    )
    // A real click starts with pointerdown; the outside-click dismiss must not
    // fire for a pointerdown inside the menu (it would unmount before onClick).
    fireEvent.pointerDown(menuItem)
    expect(screen.queryByRole('menuitem')).not.toBeNull()
    fireEvent.click(menuItem)

    await waitFor(() => expect(toggled).toEqual({ itemType: 'vod', itemId: 42 }))
    // Menu closes after selecting.
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull())
  })
})

import { createHashRouter } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { HomeScreen } from './Home'
import { LiveScreen } from './Live'
import { VodScreen } from './Vod'
import { VodDetailScreen } from './VodDetail'
import { SeriesScreen } from './Series'
import { SeriesDetailScreen } from './SeriesDetail'
import { FavoritesScreen } from './Favorites'
import { GuideScreen } from './Guide'
import { SearchScreen } from './Search'
import { SettingsScreen } from './Settings'
import { OnboardingScreen } from './Onboarding'
import { PlayerScreen } from './Player'
import { ProfilesScreen } from './Profiles'

export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'live', element: <LiveScreen /> },
      { path: 'vod', element: <VodScreen /> },
      { path: 'vod/:id', element: <VodDetailScreen /> },
      { path: 'series', element: <SeriesScreen /> },
      { path: 'series/:id', element: <SeriesDetailScreen /> },
      { path: 'favorites', element: <FavoritesScreen /> },
      { path: 'guide', element: <GuideScreen /> },
      { path: 'search', element: <SearchScreen /> },
      { path: 'settings', element: <SettingsScreen /> }
    ]
  },
  { path: '/onboarding', element: <OnboardingScreen /> },
  { path: '/profiles', element: <ProfilesScreen /> },
  { path: '/player/:itemType/:id', element: <PlayerScreen /> }
])

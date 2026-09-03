// TanStack Query hooks for browsing the cached catalog over IPC.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BrowseQuery } from '@shared/contracts'
import type { ContentKind } from '@shared/types'
import { invoke } from './api'
import { useUiStore } from '../stores/ui'

export const PAGE_SIZE = 60

export type BrowseFilters = Omit<BrowseQuery, 'cursor' | 'limit'>

export function useCategories(kind: ContentKind, providerId?: number) {
  const profileId = useUiStore((s) => s.activeProfileId) ?? undefined
  return useQuery({
    queryKey: ['catalog', 'categories', kind, providerId ?? null, profileId ?? null],
    queryFn: () => invoke('categories:list', { kind, providerId, profileId })
  })
}

export function useChannelsPage(filters: BrowseFilters) {
  return useInfiniteQuery({
    queryKey: ['catalog', 'channels:page', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      invoke('channels:page', { ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.nextCursor
  })
}

export function useVodPage(filters: BrowseFilters) {
  return useInfiniteQuery({
    queryKey: ['catalog', 'vod:page', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      invoke('vod:page', { ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.nextCursor
  })
}

export function useSeriesPage(filters: BrowseFilters) {
  return useInfiniteQuery({
    queryKey: ['catalog', 'series:page', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      invoke('series:page', { ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.nextCursor
  })
}

export function useVodDetail(vodId: number) {
  return useQuery({
    queryKey: ['catalog', 'vod-detail', vodId],
    queryFn: () => invoke('vod:detail', { vodId })
  })
}

export function useSeriesDetail(seriesId: number) {
  return useQuery({
    queryKey: ['catalog', 'series-detail', seriesId],
    queryFn: () => invoke('series:detail', { seriesId })
  })
}

export function useEpisodes(seriesId: number) {
  return useQuery({
    queryKey: ['catalog', 'episodes', seriesId],
    queryFn: () => invoke('series:episodes', { seriesId }),
    staleTime: 5 * 60_000
  })
}

export interface SearchFilters {
  year?: number
  quality?: string
  genre?: string
}

export function useSearch(term: string, kind: ContentKind, filters: SearchFilters = {}) {
  const profileId = useUiStore((s) => s.activeProfileId) ?? undefined
  const { year, quality, genre } = filters
  return useInfiniteQuery({
    queryKey: [
      'catalog',
      'search',
      kind,
      term,
      profileId ?? null,
      year ?? null,
      quality ?? null,
      genre ?? null
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      invoke('search:query', {
        term,
        kind,
        profileId,
        cursor: pageParam,
        limit: 30,
        ...(year !== undefined ? { year } : {}),
        ...(quality ? { quality } : {}),
        ...(genre ? { genre } : {})
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: term.trim().length >= 2
  })
}

// --- Favorites ------------------------------------------------------------

export function useFavorites(itemType?: ContentKind) {
  const profileId = useUiStore((s) => s.activeProfileId)
  return useQuery({
    queryKey: ['favorites', profileId, itemType ?? 'all'],
    queryFn: () => invoke('favorites:list', { profileId: profileId!, itemType }),
    enabled: profileId !== null
  })
}

/**
 * Favorites hydrated with name/artwork/category for the grouped favorites view.
 * Shares the ['favorites'] key prefix, so toggling one invalidates this too.
 */
export function useDetailedFavorites() {
  const profileId = useUiStore((s) => s.activeProfileId)
  const providerId = useUiStore((s) => s.activeProviderId) ?? undefined
  return useQuery({
    queryKey: ['favorites', 'detailed', profileId, providerId ?? null],
    queryFn: () => invoke('favorites:detailed', { profileId: profileId!, providerId }),
    enabled: profileId !== null
  })
}

export function useToggleFavorite() {
  const profileId = useUiStore((s) => s.activeProfileId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { itemType: ContentKind; itemId: number }) =>
      invoke('favorites:toggle', { profileId: profileId ?? 1, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorites'] })
      // Favorites virtual category pages must refetch too.
      void queryClient.invalidateQueries({ queryKey: ['catalog'] })
    }
  })
}

// --- History --------------------------------------------------------------

export function useRemoveHistory() {
  const profileId = useUiStore((s) => s.activeProfileId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { itemType: 'vod' | 'episode' | 'live'; itemId: number }) =>
      invoke('history:remove', { profileId: profileId ?? 1, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['history'] })
      void queryClient.invalidateQueries({ queryKey: ['catalog'] })
    }
  })
}

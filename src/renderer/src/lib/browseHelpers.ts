import { useMemo } from 'react'
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query'
import type { ContentKind, Page } from '@shared/types'
import { useFavorites } from './catalog'

/** Flatten infinite-query pages into one array for the virtualized views. */
export function useFlatPages<T>(query: UseInfiniteQueryResult<InfiniteData<Page<T>>, Error>): T[] {
  return useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
}

/** Set of favorited item ids for one content kind. */
export function useFavoriteIds(itemType: ContentKind): Set<number> {
  const { data } = useFavorites(itemType)
  return useMemo(() => new Set((data ?? []).map((f) => f.itemId)), [data])
}

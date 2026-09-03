import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CategorySidebar } from '../components/CategorySidebar'
import { PosterCard } from '../components/PosterCard'
import { VirtualPosterGrid } from '../components/VirtualPosterGrid'
import { useCategories, useVodPage } from '../lib/catalog'
import { useFavoriteIds, useFlatPages } from '../lib/browseHelpers'
import { useUiStore } from '../stores/ui'

export function VodScreen(): JSX.Element {
  const navigate = useNavigate()
  const providerId = useUiStore((s) => s.activeProviderId) ?? undefined
  const profileId = useUiStore((s) => s.activeProfileId) ?? undefined
  const category = useUiStore((s) => s.browseCategory.vod)
  const setBrowseCategory = useUiStore((s) => s.setBrowseCategory)
  const [sort, setSort] = useState<'name' | 'added'>('name')

  const { data: categories } = useCategories('vod', providerId)
  const query = useVodPage({ providerId, categoryId: category, profileId, sort })
  const movies = useFlatPages(query)
  const favoriteIds = useFavoriteIds('vod')

  return (
    <div className="flex h-full">
      <CategorySidebar
        categories={categories}
        selected={category}
        onSelect={(id) => setBrowseCategory('vod', id)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-white/5 px-4 py-2">
          <span className="text-xs text-neutral-500">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name' | 'added')}
            className="rounded-md border border-white/10 bg-surface-raised px-2 py-1 text-xs text-neutral-300 outline-none"
          >
            <option value="name">Name</option>
            <option value="added">Recently added</option>
          </select>
        </div>
        {movies.length === 0 && !query.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            No movies here yet.
          </div>
        ) : (
          <VirtualPosterGrid
            items={movies}
            hasMore={query.hasNextPage ?? false}
            onEndReached={() => void query.fetchNextPage()}
            renderCard={(movie) => (
              <PosterCard
                key={movie.id}
                name={movie.name}
                cover={movie.cover}
                rating={movie.rating}
                itemType="vod"
                itemId={movie.id}
                favorited={favoriteIds.has(movie.id)}
                onOpen={() => navigate(`/vod/${movie.id}`)}
              />
            )}
          />
        )}
      </div>
    </div>
  )
}

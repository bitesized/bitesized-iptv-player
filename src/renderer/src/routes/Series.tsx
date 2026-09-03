import { useNavigate } from 'react-router-dom'
import { CategorySidebar } from '../components/CategorySidebar'
import { PosterCard } from '../components/PosterCard'
import { VirtualPosterGrid } from '../components/VirtualPosterGrid'
import { useCategories, useSeriesPage } from '../lib/catalog'
import { useFavoriteIds, useFlatPages } from '../lib/browseHelpers'
import { useUiStore } from '../stores/ui'

export function SeriesScreen(): JSX.Element {
  const navigate = useNavigate()
  const providerId = useUiStore((s) => s.activeProviderId) ?? undefined
  const profileId = useUiStore((s) => s.activeProfileId) ?? undefined
  const category = useUiStore((s) => s.browseCategory.series)
  const setBrowseCategory = useUiStore((s) => s.setBrowseCategory)

  const { data: categories } = useCategories('series', providerId)
  const query = useSeriesPage({ providerId, categoryId: category, profileId })
  const seriesList = useFlatPages(query)
  const favoriteIds = useFavoriteIds('series')

  return (
    <div className="flex h-full">
      <CategorySidebar
        categories={categories}
        selected={category}
        onSelect={(id) => setBrowseCategory('series', id)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {seriesList.length === 0 && !query.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            No series here yet.
          </div>
        ) : (
          <VirtualPosterGrid
            items={seriesList}
            hasMore={query.hasNextPage ?? false}
            onEndReached={() => void query.fetchNextPage()}
            renderCard={(series) => (
              <PosterCard
                key={series.id}
                name={series.name}
                cover={series.cover}
                rating={series.rating}
                itemType="series"
                itemId={series.id}
                favorited={favoriteIds.has(series.id)}
                onOpen={() => navigate(`/series/${series.id}`)}
              />
            )}
          />
        )}
      </div>
    </div>
  )
}

import { memo } from 'react'
import { FavoriteButton } from './FavoriteButton'
import { ContextMenu, useContextMenu } from './ContextMenu'
import { useToggleFavorite } from '../lib/catalog'
import type { ContentKind } from '@shared/types'

export const PosterCard = memo(function PosterCard({
  name,
  cover,
  rating,
  itemType,
  itemId,
  favorited,
  onOpen
}: {
  name: string
  cover: string | null
  rating: number | null
  itemType: ContentKind
  itemId: number
  favorited: boolean
  onOpen: () => void
}): JSX.Element {
  const { menu, onContextMenu, close } = useContextMenu()
  const toggleFavorite = useToggleFavorite()

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="group relative flex w-full flex-col overflow-hidden rounded-lg bg-surface-raised text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-surface-overlay">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-neutral-600">
            {name}
          </div>
        )}
        <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
          <FavoriteButton itemType={itemType} itemId={itemId} favorited={favorited} />
        </div>
        {rating !== null && rating > 0 ? (
          <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
            ★ {rating.toFixed(1)}
          </div>
        ) : null}
      </div>
      <div className="truncate px-2 py-1.5 text-xs font-medium text-neutral-300">{name}</div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={[
            {
              label: favorited ? 'Remove from favorites' : 'Add to favorites',
              onSelect: () => toggleFavorite.mutate({ itemType, itemId })
            }
          ]}
        />
      ) : null}
    </button>
  )
})

import type { ContentKind } from '@shared/types'
import { useToggleFavorite } from '../lib/catalog'

export function FavoriteButton({
  itemType,
  itemId,
  favorited
}: {
  itemType: ContentKind
  itemId: number
  favorited: boolean
}): JSX.Element {
  const toggle = useToggleFavorite()
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        toggle.mutate({ itemType, itemId })
      }}
      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-sm transition-colors ${
        favorited ? 'text-red-400' : 'text-white/70 hover:text-white'
      }`}
    >
      {favorited ? '♥' : '♡'}
    </span>
  )
}

// A transparent, draggable strip across the top of the window. The app runs
// with titleBarStyle:'hidden' (native traffic lights float over the content, no
// title bar), so without a `-webkit-app-region: drag` region the window can't
// be moved. This also reserves the top-left where the macOS buttons sit.
//
// Interactive elements that fall under this strip must opt out of dragging with
// style={{ WebkitAppRegion: 'no-drag' }}, or they won't receive clicks.

export function WindowDragBar(): JSX.Element {
  return (
    <div
      className="absolute inset-x-0 top-0 z-40 h-8"
      style={{ WebkitAppRegion: 'drag' }}
      aria-hidden
    />
  )
}

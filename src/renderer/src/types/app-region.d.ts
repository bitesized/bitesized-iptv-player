// Allow the Electron-only `-webkit-app-region` CSS property in typed `style`
// props. Used to mark draggable window regions under titleBarStyle:'hidden'
// (the frameless native-title-bar mode) — see components/WindowDragBar.tsx.
import 'react'

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

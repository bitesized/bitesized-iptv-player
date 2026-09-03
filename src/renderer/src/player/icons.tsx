// Inline SVG icons for the player controls. Kept in-house (no icon dependency)
// and drawn in a single consistent style — 24×24 viewBox, 2px round strokes,
// `currentColor` — so every control reads as one set. Playback transport icons
// (play/pause/seek) are filled; the rest are outline, matching how mainstream
// players weight their primary vs. secondary controls.

interface IconProps {
  /** Rendered size in px (square). */
  size?: number
  className?: string
}

function Outline({
  size = 20,
  className,
  children
}: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

function Filled({
  size = 20,
  className,
  children
}: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps): JSX.Element {
  return (
    <Filled {...props}>
      <path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5Z" />
    </Filled>
  )
}

export function PauseIcon(props: IconProps): JSX.Element {
  return (
    <Filled {...props}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </Filled>
  )
}

/** Double-triangle rewind (VOD: seek back). */
export function RewindIcon(props: IconProps): JSX.Element {
  return (
    <Filled {...props}>
      <path d="M11 6v12l-8-6 8-6Z" />
      <path d="M21 6v12l-8-6 8-6Z" />
    </Filled>
  )
}

/** Double-triangle fast-forward (VOD: seek ahead). */
export function FastForwardIcon(props: IconProps): JSX.Element {
  return (
    <Filled {...props}>
      <path d="M13 6v12l8-6-8-6Z" />
      <path d="M3 6v12l8-6-8-6Z" />
    </Filled>
  )
}

/** Skip to start bar (Live: previous channel). */
export function SkipBackIcon(props: IconProps): JSX.Element {
  return (
    <Filled {...props}>
      <path d="M18 5v14l-11-7 11-7Z" />
      <rect x="4" y="5" width="2.5" height="14" rx="1" />
    </Filled>
  )
}

/** Skip to end bar (Live: next channel). */
export function SkipForwardIcon(props: IconProps): JSX.Element {
  return (
    <Filled {...props}>
      <path d="M6 5v14l11-7L6 5Z" />
      <rect x="17.5" y="5" width="2.5" height="14" rx="1" />
    </Filled>
  )
}

export function ArrowLeftIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Outline>
  )
}

export function VolumeHighIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Outline>
  )
}

export function VolumeLowIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Outline>
  )
}

export function VolumeMuteIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </Outline>
  )
}

/** Closed-caption / subtitles. */
export function SubtitlesIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h4" />
      <path d="M15 15h2" />
      <path d="M7 11h2" />
      <path d="M13 11h4" />
    </Outline>
  )
}

/** Audio track / language. */
export function AudioIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M2 10v4" />
      <path d="M6 7v10" />
      <path d="M10 4v16" />
      <path d="M14 8v8" />
      <path d="M18 6v12" />
      <path d="M22 10v4" />
    </Outline>
  )
}

export function CheckIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Outline>
  )
}

export function EnterFullscreenIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </Outline>
  )
}

export function ExitFullscreenIcon(props: IconProps): JSX.Element {
  return (
    <Outline {...props}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </Outline>
  )
}

// Accent colour themes. The accent is a single pair of CSS custom properties
// (`--color-accent` / `--color-accent-hover`, declared in styles/index.css) that
// every accent utility across the app resolves through — sliders, buttons,
// active nav, focus rings, the ticked track in the player menus, and so on.
// Switching themes just rewrites those two variables on :root, so the whole app
// re-tints consistently. The choice is persisted via the `accentTheme` setting.

export interface AccentTheme {
  id: string
  label: string
  /** Base accent (buttons, fills). */
  base: string
  /** Brighter hover/active variant, also used for accent text on dark. */
  hover: string
}

/** Persisted under this settings key (main `settings` table). */
export const ACCENT_SETTING_KEY = 'accentTheme'

export const DEFAULT_ACCENT = 'amber'

export const ACCENT_THEMES: AccentTheme[] = [
  { id: 'amber', label: 'Amber', base: '#f59e0b', hover: '#fbbf24' },
  { id: 'teal', label: 'Teal', base: '#14b8a6', hover: '#2dd4bf' },
  { id: 'emerald', label: 'Emerald', base: '#10b981', hover: '#34d399' },
  { id: 'sky', label: 'Sky', base: '#0ea5e9', hover: '#38bdf8' },
  { id: 'ocean', label: 'Ocean', base: '#2563eb', hover: '#3b82f6' },
  { id: 'violet', label: 'Violet', base: '#8b5cf6', hover: '#a78bfa' },
  { id: 'rose', label: 'Rose', base: '#f43f5e', hover: '#fb7185' },
  { id: 'graphite', label: 'Graphite', base: '#71717a', hover: '#a1a1aa' }
]

export function accentTheme(id: string | null | undefined): AccentTheme {
  return (
    ACCENT_THEMES.find((t) => t.id === id) ?? ACCENT_THEMES.find((t) => t.id === DEFAULT_ACCENT)!
  )
}

/** Write the chosen accent's variables onto the document root. */
export function applyAccent(id: string | null | undefined): void {
  const theme = accentTheme(id)
  const root = document.documentElement
  root.style.setProperty('--color-accent', theme.base)
  root.style.setProperty('--color-accent-hover', theme.hover)
}

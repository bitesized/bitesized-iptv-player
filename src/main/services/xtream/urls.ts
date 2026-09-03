// Xtream URL construction. Pure functions — unit tested.

export interface XtreamCredentials {
  baseUrl: string
  username: string
  password: string
}

/** Normalize a user-entered base URL: strip trailing slashes and any path. */
export function normalizeBaseUrl(input: string): string {
  let raw = input.trim()
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`
  }
  const url = new URL(raw)
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname}${port}`
}

export function playerApiUrl(
  creds: XtreamCredentials,
  action?: string,
  extra?: Record<string, string | number>
): string {
  const url = new URL('/player_api.php', creds.baseUrl)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  if (action) url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(extra ?? {})) {
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function liveStreamUrl(
  creds: XtreamCredentials,
  streamId: string | number,
  ext: 'ts' | 'm3u8' = 'ts'
): string {
  return `${creds.baseUrl}/live/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${streamId}.${ext}`
}

export function vodStreamUrl(
  creds: XtreamCredentials,
  streamId: string | number,
  containerExt: string
): string {
  return `${creds.baseUrl}/movie/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${streamId}.${containerExt}`
}

export function seriesEpisodeUrl(
  creds: XtreamCredentials,
  episodeId: string | number,
  containerExt: string
): string {
  return `${creds.baseUrl}/series/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${episodeId}.${containerExt}`
}

/**
 * Format an instant as Xtream's timeshift start token, `YYYY-MM-DD:HH-MM`.
 * Xtream panels interpret this in their *own* local time; we have only an epoch,
 * so we format in the device's local time — usually the same region for an IPTV
 * subscription. (A provider in a different tz may be off by the tz delta.)
 */
export function formatTimeshiftStart(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}:${p(
    date.getHours()
  )}-${p(date.getMinutes())}`
}

/** Catch-up/timeshift URL for channels with tv_archive=1. */
export function timeshiftUrl(
  creds: XtreamCredentials,
  streamId: string | number,
  /** Start time as 'YYYY-MM-DD:HH-MM' (Xtream convention). */
  start: string,
  durationMinutes: number
): string {
  const url = new URL('/streaming/timeshift.php', creds.baseUrl)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  url.searchParams.set('stream', String(streamId))
  url.searchParams.set('start', start)
  url.searchParams.set('duration', String(durationMinutes))
  return url.toString()
}

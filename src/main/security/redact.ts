/**
 * Provider URLs are credentials. An M3U playlist URL is typically
 * `http://host/get.php?username=U&password=P&type=m3u_plus` — anyone who reads
 * it has the whole subscription — and Xtream stream URLs carry the same pair as
 * path segments. These helpers produce a form safe to show in the UI, put in an
 * error message, or hand to the renderer.
 */

const SECRET_PARAMS = new Set(['username', 'password', 'pass', 'user', 'token', 'key', 'auth'])
const MASK = '•••'

/**
 * Mask credentials in a URL, keeping enough shape for the user to recognise
 * which provider it is. Returns the input unchanged if it isn't a URL (local
 * playlist paths share the column and aren't secrets).
 */
export function redactUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return value

  if (url.username) url.username = MASK
  if (url.password) url.password = MASK

  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAMS.has(name.toLowerCase())) url.searchParams.set(name, MASK)
  }

  // Xtream stream URLs put the pair in the path: /live/USER/PASS/123.ts
  url.pathname = url.pathname.replace(
    /^\/(live|movie|series)\/[^/]+\/[^/]+\//i,
    (_all, kind: string) => `/${kind}/${MASK}/${MASK}/`
  )

  return decodeURIComponent(url.toString())
}

/**
 * Mask any URLs embedded in free text. Provider/network errors routinely quote
 * the URL they failed on, and those strings are persisted to
 * `providers.status_message` and rendered in Settings.
 */
export function redactText(value: string): string {
  return value.replace(/https?:\/\/[^\s'"<>]+/gi, (match) => redactUrl(match))
}

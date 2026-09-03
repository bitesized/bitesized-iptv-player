// Streaming M3U/M3U8 playlist parser. Works line-by-line so
// a 100k-entry playlist never has to fit in memory as a parsed structure —
// callers consume entries from a generator.

export interface M3uEntry {
  /** Display name (text after the last comma of #EXTINF). */
  name: string
  url: string
  /** Raw #EXTINF attributes: tvg-id, tvg-name, tvg-logo, group-title, … */
  attrs: Record<string, string>
  durationSecs: number | null
}

export interface M3uHeader {
  /** url-tvg / x-tvg-url attribute — XMLTV EPG source, when present. */
  epgUrl: string | null
}

const ATTR_RE = /([A-Za-z0-9_.-]+)=(?:"([^"]*)"|([^\s]+))/g

export function parseExtinfAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  // Attributes live between '#EXTINF:<duration>' and the final comma; scanning
  // the whole line is tolerant of odd orderings.
  const beforeComma = line.slice(0, line.lastIndexOf(','))
  for (const match of beforeComma.matchAll(ATTR_RE)) {
    const key = match[1]!.toLowerCase()
    attrs[key] = (match[2] ?? match[3] ?? '').trim()
  }
  return attrs
}

export function parseHeader(line: string): M3uHeader {
  const attrs = parseExtinfAttrs(`${line},`)
  return { epgUrl: attrs['url-tvg'] ?? attrs['x-tvg-url'] ?? null }
}

/**
 * Parse playlist lines into entries. `lines` can be any (async) iterable of
 * individual lines — pair with readline over a network/file stream.
 */
export async function* parseM3u(
  lines: AsyncIterable<string> | Iterable<string>,
  onHeader?: (header: M3uHeader) => void
): AsyncGenerator<M3uEntry> {
  let pending: { name: string; attrs: Record<string, string>; durationSecs: number | null } | null =
    null

  for await (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    if (line.startsWith('#EXTM3U')) {
      onHeader?.(parseHeader(line))
      continue
    }
    if (line.startsWith('#EXTINF')) {
      const commaIdx = line.lastIndexOf(',')
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : ''
      const durationMatch = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)/.exec(line)
      const duration = durationMatch ? Number(durationMatch[1]) : null
      const attrs = parseExtinfAttrs(line)
      pending = {
        name: name || attrs['tvg-name'] || 'Unnamed',
        attrs,
        durationSecs: duration !== null && duration > 0 ? duration : null
      }
      continue
    }
    if (line.startsWith('#')) continue // other directives (#EXTGRP etc.) ignored for now

    // A non-comment line is a stream URL, closing any pending #EXTINF.
    if (pending) {
      yield { ...pending, url: line }
      pending = null
    } else {
      yield { name: line, url: line, attrs: {}, durationSecs: null }
    }
  }
}

// --- Classification -------------------------------------------------------

export type M3uKind = 'live' | 'vod'

const VOD_EXTENSIONS = /\.(mp4|mkv|avi|mov|wmv|flv|webm|mpg|mpeg|m4v)(\?.*)?$/i
const VOD_GROUP_HINT = /\b(vod|movie|movies|film|films|series|shows?)\b/i

/**
 * Live vs VOD heuristic: file-like extensions or VOD-ish group titles are VOD,
 * everything else (ts/m3u8/extension-less) is treated as live.
 */
export function classifyEntry(entry: M3uEntry): M3uKind {
  if (VOD_EXTENSIONS.test(entry.url)) return 'vod'
  const group = entry.attrs['group-title']
  if (group && VOD_GROUP_HINT.test(group)) return 'vod'
  return 'live'
}

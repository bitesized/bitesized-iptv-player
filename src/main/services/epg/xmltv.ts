// Streaming XMLTV parser (sax) — handles multi-hundred-MB guides without
// buffering the document. Emits programme rows for epg_programmes.

import sax from 'sax'
import type { Readable } from 'node:stream'
import type { ProgrammeRow } from '@main/db/repos/epg'

/** Parse XMLTV timestamps: 'YYYYMMDDHHMMSS [+-]HHMM' (offset optional). */
export function parseXmltvDate(value: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second, offset] = match
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0')
  )
  let offsetMs = 0
  if (offset) {
    const sign = offset.startsWith('-') ? -1 : 1
    const hours = Number(offset.slice(1, 3))
    const minutes = Number(offset.slice(3, 5))
    offsetMs = sign * (hours * 60 + minutes) * 60_000
  }
  return Math.floor((utc - offsetMs) / 1000)
}

/**
 * Stream-parse an XMLTV document, invoking `onProgramme` per <programme>.
 * Resolves with the number of programmes parsed.
 */
export function parseXmltv(
  stream: Readable,
  onProgramme: (row: ProgrammeRow) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(false, { lowercase: true, trim: true })

    let count = 0
    let current: { channel: string; start: number; stop: number } | null = null
    let title = ''
    let desc = ''
    let category = ''
    let textTarget: 'title' | 'desc' | 'category' | null = null

    parser.on('opentag', (node) => {
      if (node.name === 'programme') {
        const attrs = node.attributes as Record<string, string>
        const start = attrs['start'] ? parseXmltvDate(attrs['start']) : null
        const stop = attrs['stop'] ? parseXmltvDate(attrs['stop']) : null
        const channel = attrs['channel']
        current = start !== null && stop !== null && channel ? { channel, start, stop } : null
        title = ''
        desc = ''
        category = ''
      } else if (current) {
        if (node.name === 'title') textTarget = 'title'
        else if (node.name === 'desc') textTarget = 'desc'
        else if (node.name === 'category') textTarget = 'category'
      }
    })

    parser.on('text', (text) => {
      if (!textTarget) return
      if (textTarget === 'title') title += text
      else if (textTarget === 'desc') desc += text
      else category += text
    })

    parser.on('closetag', (name) => {
      if (name === 'title' || name === 'desc' || name === 'category') {
        textTarget = null
      } else if (name === 'programme' && current) {
        if (title.trim().length > 0) {
          onProgramme({
            epgChannelId: current.channel,
            start: current.start,
            stop: current.stop,
            title: title.trim(),
            description: desc.trim() || null,
            category: category.trim() || null
          })
          count++
        }
        current = null
      }
    })

    parser.on('error', (err) => reject(err))
    parser.on('end', () => resolve(count))
    stream.on('error', (err) => reject(err))
    stream.pipe(parser)
  })
}

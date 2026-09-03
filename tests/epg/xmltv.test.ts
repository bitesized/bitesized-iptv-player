import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { parseXmltv, parseXmltvDate } from '@main/services/epg/xmltv'
import type { ProgrammeRow } from '@main/db/repos/epg'

describe('parseXmltvDate', () => {
  it('parses with timezone offsets', () => {
    // 2026-07-23 20:00:00 +0000
    expect(parseXmltvDate('20260723200000 +0000')).toBe(
      Math.floor(Date.UTC(2026, 6, 23, 20, 0, 0) / 1000)
    )
    // +0200 means local is ahead — UTC is 18:00.
    expect(parseXmltvDate('20260723200000 +0200')).toBe(
      Math.floor(Date.UTC(2026, 6, 23, 18, 0, 0) / 1000)
    )
    expect(parseXmltvDate('20260723200000 -0130')).toBe(
      Math.floor(Date.UTC(2026, 6, 23, 21, 30, 0) / 1000)
    )
  })

  it('parses without offset or seconds', () => {
    expect(parseXmltvDate('202607232000')).toBe(Math.floor(Date.UTC(2026, 6, 23, 20, 0) / 1000))
  })

  it('rejects garbage', () => {
    expect(parseXmltvDate('not-a-date')).toBeNull()
  })
})

describe('parseXmltv', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="one.uk"><display-name>One</display-name></channel>
  <programme start="20260723200000 +0000" stop="20260723210000 +0000" channel="one.uk">
    <title lang="en">Evening News</title>
    <desc lang="en">The day&apos;s events.</desc>
    <category lang="en">News</category>
  </programme>
  <programme start="20260723210000 +0000" stop="20260723220000 +0000" channel="one.uk">
    <title>Late Film</title>
  </programme>
  <programme start="badstamp" stop="20260723220000 +0000" channel="one.uk">
    <title>Broken</title>
  </programme>
</tv>`

  it('emits valid programmes and skips broken ones', async () => {
    const rows: ProgrammeRow[] = []
    const count = await parseXmltv(Readable.from([xml]), (row) => rows.push(row))
    expect(count).toBe(2)
    expect(rows[0]).toEqual({
      epgChannelId: 'one.uk',
      start: Math.floor(Date.UTC(2026, 6, 23, 20, 0, 0) / 1000),
      stop: Math.floor(Date.UTC(2026, 6, 23, 21, 0, 0) / 1000),
      title: 'Evening News',
      description: "The day's events.",
      category: 'News'
    })
    expect(rows[1]!.title).toBe('Late Film')
    expect(rows[1]!.description).toBeNull()
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { XtreamClient } from '@main/services/xtream/client'

// Real loopback servers rather than MockAgent: the behaviour under test is how
// the client copes with slow/broken bodies, which a mock can't reproduce.

let server: Server | null = null

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler)
  server = s
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))
  const address = s.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

function client(baseUrl: string, idleMs = 200): XtreamClient {
  return new XtreamClient(
    { baseUrl, username: 'u', password: 'p' },
    { firstByteMs: idleMs, idleMs }
  )
}

afterEach(async () => {
  const s = server
  server = null
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
})

describe('XtreamClient', () => {
  it('reads a body that arrives in chunks slower than the idle timeout', async () => {
    // Three chunks 120ms apart: 360ms total, well past a 200ms *wall-clock*
    // budget but never 200ms of silence. This is the large-catalogue case that
    // used to fail as "invalid JSON".
    const items = [
      { stream_id: 1, name: 'A' },
      { stream_id: 2, name: 'B' }
    ]
    const json = JSON.stringify(items)
    const parts = [json.slice(0, 10), json.slice(10, 25), json.slice(25)]
    const baseUrl = await serve(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      for (const part of parts) {
        await new Promise((r) => setTimeout(r, 120))
        res.write(part)
      }
      res.end()
    })

    await expect(client(baseUrl).getVodStreams()).resolves.toEqual(items)
  })

  it('reports a stalled download as a stall, not as invalid JSON', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('[{"stream_id":1,')
      // ...then never another byte.
    })

    await expect(client(baseUrl).getVodStreams()).rejects.toThrow(/stalled/i)
    await expect(client(baseUrl).getVodStreams()).rejects.not.toThrow(/invalid JSON/i)
  })

  it('reports a dropped connection as a download failure, not as invalid JSON', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('[{"stream_id":1,')
      // Give the headers time to land, so the failure happens mid-body rather
      // than during connect.
      setTimeout(() => res.socket?.destroy(), 50)
    })

    await expect(client(baseUrl).getVodStreams()).rejects.toThrow(/Download failed/i)
    await expect(client(baseUrl).getVodStreams()).rejects.not.toThrow(/invalid JSON/i)
  })

  it('still reports genuinely malformed JSON as invalid JSON', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<b>Fatal error</b>')
    })

    await expect(client(baseUrl).getVodStreams()).rejects.toThrow(
      /invalid JSON \(get_vod_streams\)/
    )
  })

  it('surfaces a non-200 with its status', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(512).end()
    })

    await expect(client(baseUrl).getVodStreams()).rejects.toThrow(/HTTP 512/)
  })
})

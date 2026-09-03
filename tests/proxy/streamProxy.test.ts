import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { isPrivateAddress, StreamProxy } from '@main/services/proxy/streamProxy'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1'
  ])('rejects %s', (ip) => expect(isPrivateAddress(ip)).toBe(true))

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '99.1.1.1', '2606:4700::1'])(
    'allows %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false)
  )
})

describe('StreamProxy', () => {
  let upstream: Server
  let upstreamPort: number
  let proxy: StreamProxy
  let requests: IncomingMessage[]

  beforeEach(async () => {
    requests = []
    upstream = createServer((req, res) => {
      requests.push(req)
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://127.0.0.1:${upstreamPort}/video.mp4` })
        res.end()
        return
      }
      if (req.url === '/video.mp4') {
        if (req.headers.range === 'bytes=4-7') {
          res.writeHead(206, {
            'content-type': 'video/mp4',
            'content-range': 'bytes 4-7/10',
            'content-length': '4'
          })
          res.end('4567')
          return
        }
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '10' })
        res.end('0123456789')
        return
      }
      if (req.url === '/logo.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end('PNGDATA')
        return
      }
      if (req.url === '/live.m3u8') {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
        res.end('#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n')
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    upstreamPort = (upstream.address() as { port: number }).port
    proxy = new StreamProxy()
    await proxy.start()
  })

  afterEach(() => {
    proxy.stop()
    upstream.close()
  })

  it('streams upstream content and injects the app User-Agent', async () => {
    const url = proxy.register(`http://127.0.0.1:${upstreamPort}/video.mp4`)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9]{32}\.mp4$/)

    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
    expect(requests[0]!.headers['user-agent']).toBe('IPTVPlayer/0.1')
  })

  it('follows upstream redirects', async () => {
    const url = proxy.register(`http://127.0.0.1:${upstreamPort}/redirect`)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
  })

  it('passes Range requests through', async () => {
    const url = proxy.register(`http://127.0.0.1:${upstreamPort}/video.mp4`)
    const response = await fetch(url, { headers: { range: 'bytes=4-7' } })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('4567')
    expect(response.headers.get('content-range')).toBe('bytes 4-7/10')
  })

  it('rewrites HLS playlists so segments route through the proxy', async () => {
    const url = proxy.register(`http://127.0.0.1:${upstreamPort}/live.m3u8`)
    const response = await fetch(url)
    const body = await response.text()

    const segmentLine = body.split('\n').find((l) => l.includes('seg1.ts'))
    expect(segmentLine).toMatch(/^\/s\/[a-f0-9]{32}\.m3u8\?u=/)
    expect(decodeURIComponent(segmentLine!)).toContain(`http://127.0.0.1:${upstreamPort}/seg1.ts`)
    expect(body).toMatch(/URI="\/s\/[a-f0-9]{32}\.m3u8\?u=.*key\.bin/)

    // And a rewritten segment URL actually serves through the proxy.
    const segPath = segmentLine!.trim()
    const segResponse = await fetch(`${new URL(url).origin}${segPath}`)
    expect(segResponse.status).toBe(404) // upstream has no seg1.ts — but it was proxied
    expect(requests.at(-1)!.url).toBe('/seg1.ts')
  })

  it('404s unknown tokens', async () => {
    await proxy.start()
    const port = new URL(proxy.register(`http://127.0.0.1:${upstreamPort}/video.mp4`)).port
    const response = await fetch(`http://127.0.0.1:${port}/s/${'0'.repeat(32)}`)
    expect(response.status).toBe(404)
  })

  describe('?u= is provider-controlled and must not pivot to private hosts', () => {
    it('refuses a cross-origin ?u= pointing at a loopback service', async () => {
      // A second server standing in for something unrelated on the machine.
      const victim = createServer((_req, res) => res.writeHead(200).end('INTERNAL'))
      await new Promise<void>((resolve) => victim.listen(0, '127.0.0.1', resolve))
      const victimPort = (victim.address() as { port: number }).port

      // The upstream is registered against a *public* hostname, so loopback is
      // not covered by the same-origin allowance.
      const url = proxy.register('http://provider.example/live.m3u8')
      const token = /\/s\/([a-f0-9]{32})/.exec(url)![1]
      const attack = `${new URL(url).origin}/s/${token}.m3u8?u=${encodeURIComponent(
        `http://127.0.0.1:${victimPort}/admin`
      )}`

      const response = await fetch(attack)
      const body = await response.text()

      victim.close()
      expect(body).not.toContain('INTERNAL')
      expect(response.status).toBe(403)
    })

    it('still allows ?u= on the upstream origin (LAN-hosted providers)', async () => {
      const url = proxy.register(`http://127.0.0.1:${upstreamPort}/live.m3u8`)
      const token = /\/s\/([a-f0-9]{32})/.exec(url)![1]
      const response = await fetch(
        `${new URL(url).origin}/s/${token}.m3u8?u=${encodeURIComponent(
          `http://127.0.0.1:${upstreamPort}/video.mp4`
        )}`
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('0123456789')
    })

    it('refuses non-http schemes', async () => {
      const url = proxy.register(`http://127.0.0.1:${upstreamPort}/video.mp4`)
      const token = /\/s\/([a-f0-9]{32})/.exec(url)![1]
      const response = await fetch(
        `${new URL(url).origin}/s/${token}?u=${encodeURIComponent('file:///etc/passwd')}`
      )
      expect(response.status).toBe(403)
    })
  })

  describe('image proxying', () => {
    it('serves artwork on a trusted origin and hides the host from the renderer', async () => {
      proxy.setTrustedOrigins([`http://127.0.0.1:${upstreamPort}`])
      const url = proxy.registerImage(`http://127.0.0.1:${upstreamPort}/logo.png`)
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/img\?u=/)

      const response = await fetch(url!)
      expect(response.status).toBe(200)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.text()).toBe('PNGDATA')
    })

    it('rejects an unsigned or tampered image URL', async () => {
      proxy.setTrustedOrigins([`http://127.0.0.1:${upstreamPort}`])
      const signed = proxy.registerImage(`http://127.0.0.1:${upstreamPort}/logo.png`)!
      const sig = new URL(signed).searchParams.get('sig')!

      // Same signature, different target — the HMAC covers the URL.
      const tampered = `${new URL(signed).origin}/img?u=${encodeURIComponent(
        `http://127.0.0.1:${upstreamPort}/video.mp4`
      )}&sig=${sig}`
      expect((await fetch(tampered)).status).toBe(403)

      const unsigned = `${new URL(signed).origin}/img?u=${encodeURIComponent(
        `http://127.0.0.1:${upstreamPort}/logo.png`
      )}`
      expect((await fetch(unsigned)).status).toBe(403)
    })

    it('refuses to pass through non-image responses', async () => {
      proxy.setTrustedOrigins([`http://127.0.0.1:${upstreamPort}`])
      const url = proxy.registerImage(`http://127.0.0.1:${upstreamPort}/video.mp4`)!
      expect((await fetch(url)).status).toBe(415)
    })

    it('leaves non-http artwork values out entirely', () => {
      expect(proxy.registerImage(null)).toBeNull()
      expect(proxy.registerImage('javascript:alert(1)')).toBeNull()
    })
  })
})

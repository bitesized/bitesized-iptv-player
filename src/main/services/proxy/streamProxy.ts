// Local stream proxy. The renderer/player never talks to
// provider hosts directly: stream URLs are registered here and served from
// 127.0.0.1, with the proxy injecting a stable User-Agent, following
// redirects, and passing Range requests through for seeking.

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns'
import { isIPv4, isIPv6 } from 'node:net'
import { Readable } from 'node:stream'
import { Agent, interceptors, request } from 'undici'
import type { Dispatcher } from 'undici'

const USER_AGENT = 'IPTVPlayer/0.1'
const MAX_TOKENS = 2000

// undici v7 handles redirects via a composed interceptor, not a request flag.
const dispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 5 }))

/**
 * Dispatcher for targets the *provider's content* chose rather than the user:
 * cross-origin HLS segments and artwork URLs. Refuses to connect to private,
 * loopback or link-local addresses, so a hostile playlist can't aim the proxy
 * at the user's router or at services on their machine.
 *
 * The guard lives in `connect.lookup` rather than in a pre-flight URL check
 * because that is the one place every socket passes through — it covers
 * redirects and DNS names that resolve into private space alike.
 */
const guardedDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, options, (err, address, family) => {
        if (err) {
          callback(err, address as never, family as never)
          return
        }
        const addresses = Array.isArray(address) ? address : [{ address, family }]
        for (const entry of addresses) {
          if (isPrivateAddress(entry.address)) {
            callback(
              new Error(`Refusing to connect to private address ${entry.address}`),
              address as never,
              family as never
            )
            return
          }
        }
        callback(null, address as never, family as never)
      })
    }
  }
}).compose(interceptors.redirect({ maxRedirections: 5 }))

/** Loopback, private, link-local, CGNAT and unique-local ranges. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIPv4(addr)) {
    const [a = 0, b = 0] = addr.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  const v6 = addr.toLowerCase()
  if (v6 === '::' || v6 === '::1') return true
  // fc00::/7 (unique local) and fe80::/10 (link local).
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

interface Upstream {
  url: string
}

export class StreamProxy {
  private server: Server | null = null
  private port = 0
  /** token → upstream; insertion-ordered for LRU eviction. */
  private readonly upstreams = new Map<string, Upstream>()
  /**
   * Per-session key signing image URLs. Artwork is unbounded (one URL per
   * catalog row), so it can't use the capped token map without evicting live
   * stream tokens — instead each image URL carries an HMAC that only main can
   * mint, which keeps /img from being an open forward proxy.
   */
  private readonly imageKey = randomBytes(32)
  /**
   * Origins the *user* configured (provider hosts, EPG hosts). These keep the
   * unrestricted dispatcher so a self-hosted provider on the LAN still works;
   * every other target is provider-content-chosen and gets the private-address
   * guard. Refreshed by main whenever the provider list changes.
   */
  private trustedOrigins = new Set<string>()

  setTrustedOrigins(urls: (string | null)[]): void {
    this.trustedOrigins = new Set(
      urls.flatMap((url) => {
        if (!url) return []
        try {
          return [new URL(url).origin]
        } catch {
          return []
        }
      })
    )
  }

  /**
   * How a target may be fetched, or `null` to refuse it outright.
   *
   * User-configured hosts (the token's own upstream, and provider/EPG origins)
   * get the unrestricted dispatcher. Everything else is provider-chosen and is
   * held to public addresses: literal private IPs are rejected here, because a
   * socket to a bare address never passes through `connect.lookup` — that hook
   * only ever sees DNS names, which it guards in turn.
   */
  private policyFor(target: string, upstreamUrl?: string): Dispatcher | null {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (upstreamUrl !== undefined && sameOrigin(target, upstreamUrl)) return dispatcher
    if (this.trustedOrigins.has(url.origin)) return dispatcher
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if ((isIPv4(host) || isIPv6(host)) && isPrivateAddress(host)) return null
    return guardedDispatcher
  }

  async start(): Promise<number> {
    if (this.server) return this.port
    const server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Proxy failed to bind')
    }
    this.port = address.port
    return this.port
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** Origin the renderer and player are allowed to talk to. */
  get origin(): string {
    if (this.server === null) throw new Error('Proxy not started')
    return `http://127.0.0.1:${this.port}`
  }

  /** True when `url` is served by this proxy — the only origin mpv may load. */
  ownsUrl(url: string): boolean {
    if (this.server === null) return false
    try {
      return new URL(url).origin === this.origin
    } catch {
      return false
    }
  }

  /**
   * Register an upstream URL and get back a local proxied URL. The original
   * extension is kept so players can infer the container.
   */
  register(upstreamUrl: string): string {
    if (this.server === null) throw new Error('Proxy not started')
    const token = randomBytes(16).toString('hex')
    this.upstreams.set(token, { url: upstreamUrl })
    while (this.upstreams.size > MAX_TOKENS) {
      const oldest = this.upstreams.keys().next().value
      if (oldest === undefined) break
      this.upstreams.delete(oldest)
    }
    const ext = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(upstreamUrl)?.[1]
    return `${this.origin}/s/${token}${ext ? `.${ext}` : ''}`
  }

  /**
   * Proxy an artwork URL (channel logo, poster, still). Keeps provider and
   * third-party image hosts from seeing the user's IP and from being used as
   * browse-time tracking beacons via playlist-supplied `tvg-logo`.
   */
  registerImage(imageUrl: string | null): string | null {
    if (imageUrl === null || this.server === null) return imageUrl
    if (!/^https?:\/\//i.test(imageUrl)) return null
    const sig = this.signImage(imageUrl)
    return `${this.origin}/img?u=${encodeURIComponent(imageUrl)}&sig=${sig}`
  }

  private signImage(url: string): string {
    return createHmac('sha256', this.imageKey).update(url).digest('hex')
  }

  private imageSignatureValid(url: string, sig: string): boolean {
    const expected = Buffer.from(this.signImage(url), 'utf8')
    const actual = Buffer.from(sig, 'utf8')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')

    if (requestUrl.pathname === '/img') {
      await this.handleImage(requestUrl, res)
      return
    }

    const match = /^\/s\/([a-f0-9]{32})(?:\.[a-z0-9]+)?$/i.exec(requestUrl.pathname)
    const upstream = match ? this.upstreams.get(match[1]!) : undefined
    if (!upstream) {
      res.writeHead(404).end()
      return
    }

    // HLS playlists reference segments relatively; resolve them against the
    // upstream and proxy those too (?u= carries the absolute segment URL).
    //
    // ?u= is provider-controlled, so it can't be trusted like the registered
    // upstream. Only the upstream's own origin (and other user-configured
    // hosts) keep the unrestricted dispatcher — that's what lets a LAN-hosted
    // provider serve its own segments. Anything else, whether a legitimate CDN
    // or an attacker's pivot, goes through the private-address guard.
    const target = requestUrl.searchParams.get('u') ?? upstream.url
    const chosen = this.policyFor(target, upstream.url)
    if (chosen === null) {
      res.writeHead(403).end()
      return
    }

    const headers: Record<string, string> = { 'user-agent': USER_AGENT }
    if (req.headers.range) headers['range'] = req.headers.range

    try {
      const response = await request(target, {
        method: 'GET',
        headers,
        dispatcher: chosen,
        bodyTimeout: 60_000,
        headersTimeout: 30_000
      })

      const contentType = String(response.headers['content-type'] ?? 'application/octet-stream')
      const passthrough: Record<string, string> = { 'content-type': contentType }
      for (const name of ['content-length', 'accept-ranges', 'content-range'] as const) {
        const value = response.headers[name]
        if (typeof value === 'string') passthrough[name] = value
      }

      const isPlaylist = contentType.includes('mpegurl') || /\.m3u8(\?.*)?$/i.test(target)
      if (isPlaylist) {
        // Rewrite playlist URIs so segment/variant requests come back through us.
        const body = await response.body.text()
        const rewritten = this.rewritePlaylist(body, target, match![1]!)
        delete passthrough['content-length']
        res.writeHead(response.statusCode, passthrough)
        res.end(rewritten)
        return
      }

      res.writeHead(response.statusCode, passthrough)
      const stream = Readable.from(response.body)
      stream.pipe(res)
      res.on('close', () => stream.destroy())
    } catch {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    }
  }

  /**
   * Serve an artwork URL that main signed. Responses are forced to an image
   * content-type with nosniff so a host that returns HTML/JS can't have it
   * interpreted as anything but a (broken) image.
   */
  private async handleImage(requestUrl: URL, res: ServerResponse): Promise<void> {
    const target = requestUrl.searchParams.get('u')
    const sig = requestUrl.searchParams.get('sig')
    if (!target || !sig || !this.imageSignatureValid(target, sig)) {
      res.writeHead(403).end()
      return
    }
    const chosen = this.policyFor(target)
    if (chosen === null) {
      res.writeHead(403).end()
      return
    }

    try {
      const response = await request(target, {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT },
        dispatcher: chosen,
        bodyTimeout: 30_000,
        headersTimeout: 15_000
      })
      const contentType = String(response.headers['content-type'] ?? '')
      if (!contentType.startsWith('image/')) {
        // dump() drains and discards; destroy() would surface as an unhandled
        // AbortError on the connection.
        await response.body.dump().catch(() => {})
        res.writeHead(415).end()
        return
      }
      res.writeHead(response.statusCode, {
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=86400'
      })
      const stream = Readable.from(response.body)
      stream.pipe(res)
      res.on('close', () => stream.destroy())
    } catch {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    }
  }

  private rewritePlaylist(body: string, baseUrl: string, token: string): string {
    const rewrite = (uri: string): string => {
      try {
        const absolute = new URL(uri, baseUrl).toString()
        return `/s/${token}.m3u8?u=${encodeURIComponent(absolute)}`
      } catch {
        return uri
      }
    }
    return body
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (trimmed.length === 0) return line
        if (trimmed.startsWith('#')) {
          // Rewrite URI="..." attributes (keys, alternate renditions).
          return line.replace(/URI="([^"]+)"/g, (_all, uri: string) => `URI="${rewrite(uri)}"`)
        }
        return rewrite(trimmed)
      })
      .join('\n')
  }
}

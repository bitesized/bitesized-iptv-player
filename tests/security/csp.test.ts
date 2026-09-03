import { describe, expect, it } from 'vitest'
import { buildCsp } from '@main/security/csp'

describe('buildCsp', () => {
  it('production forbids inline script execution', () => {
    const csp = buildCsp(false)
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).toBeDefined()
    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval')
  })

  it("dev allows Vite's inline react-refresh preamble (regression: black screen)", () => {
    // @vitejs/plugin-react injects an inline <script> into index.html in dev;
    // a strict script-src blocked it and the renderer never mounted.
    const scriptSrc = buildCsp(true)
      .split(';')
      .find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).toContain("'unsafe-inline'")
  })

  it('always locks down objects, base-uri and default-src', () => {
    for (const dev of [true, false]) {
      const csp = buildCsp(dev)
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("base-uri 'none'")
    }
  })

  it('allows locally-proxied images and streams plus HMR websockets in dev', () => {
    const csp = buildCsp(true)
    expect(csp).toMatch(/img-src[^;]*127\.0\.0\.1/)
    expect(csp).toMatch(/media-src[^;]*127\.0\.0\.1/)
    expect(csp).toMatch(/connect-src[^;]*ws:/)
  })

  it('production reaches no remote origin — everything is proxied via 127.0.0.1', () => {
    // Artwork, streams and subtitles are all rewritten by main onto the local
    // proxy, so a playlist-supplied URL can never be fetched by the renderer.
    const csp = buildCsp(false)
    for (const directive of csp.split(';').map((d) => d.trim())) {
      expect(directive).not.toMatch(/(^|\s)https?:(\s|$)/)
      expect(directive).not.toContain('*.')
    }
    expect(csp).toMatch(/img-src[^;]*127\.0\.0\.1/)
    expect(csp).not.toMatch(/connect-src[^;]*ws:/)
  })

  it('blocks framing and form submission', () => {
    for (const dev of [true, false]) {
      expect(buildCsp(dev)).toContain("frame-ancestors 'none'")
      expect(buildCsp(dev)).toContain("form-action 'none'")
    }
  })
})

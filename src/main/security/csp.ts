/**
 * Content-Security-Policy for the renderer.
 *
 * Production is strict: no inline/eval script, and no remote origins at all.
 * Streams, artwork and subtitles are all rewritten by main onto the local
 * stream proxy, so the renderer only ever needs 127.0.0.1 — which means a
 * hostile playlist can't turn a poster URL into a tracking beacon or reach a
 * remote host from inside the app.
 *
 * Dev must additionally allow inline scripts and the Vite dev server, because
 * @vitejs/plugin-react injects an inline react-refresh preamble into
 * index.html — blocking it leaves a black screen.
 */
export function buildCsp(dev: boolean): string {
  const local = 'http://127.0.0.1:* http://localhost:*'
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${local}`,
    `media-src 'self' blob: ${local}`,
    dev ? `connect-src 'self' ws: ${local}` : `connect-src 'self' ${local}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:"
  ].join('; ')
}

// Holds a transparent Electron window at a known position playing the colorful
// SMPTE test pattern via the embedded libmpv addon, so an external screencapture
// can confirm the video composites in-window below the DOM controls overlay.
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const addon = require(join(root, 'native', 'mpv-embed', 'build', 'Release', 'mpv_embed.node'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: 100,
    y: 100,
    width: 640,
    height: 480,
    show: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false
  })
  win.setPosition(100, 100)
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<body style="margin:0;background:transparent;overflow:hidden">' +
          '<div style="position:absolute;bottom:0;width:100%;height:56px;' +
          'background:linear-gradient(transparent,rgba(0,0,0,.85));color:#fff;' +
          'font:16px -apple-system,sans-serif;display:flex;align-items:flex-end;' +
          'padding:0 16px 12px;box-sizing:border-box">▶ DOM controls over native mpv video</div></body>'
      )
  )
  win.focus()
  win.moveTop()

  addon.create(win.getNativeWindowHandle(), () => {})
  addon.command(['loadfile', 'av://lavfi:testsrc2=size=640x480:rate=30', 'replace'])
  addon.setProperty('pause', 'no')

  setTimeout(() => {
    addon.destroy()
    win.destroy()
    app.quit()
  }, 12000)
})

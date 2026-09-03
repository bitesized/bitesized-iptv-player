// Reproduce the EmbeddedMpvController.load() command sequence to find which
// mpv_command returns "invalid parameter".
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const addon = require(join(root, 'native', 'mpv-embed', 'build', 'Release', 'mpv_embed.node'))

function tryCmd(label, args) {
  try {
    addon.command(args)
    console.log(`OK   ${label}: [${args.join(', ')}]`)
  } catch (e) {
    console.log(`FAIL ${label}: [${args.join(', ')}] -> ${e.message}`)
  }
}

function tryProp(label, name, value) {
  try {
    addon.setProperty(name, value)
    console.log(`OK   ${label}: setProperty(${name}, ${value})`)
  } catch (e) {
    console.log(`FAIL ${label}: setProperty(${name}, ${value}) -> ${e.message}`)
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false, transparent: true })
  await win.loadURL('data:text/html,x')

  const seen = new Set()
  let ticks = 0
  addon.create(win.getNativeWindowHandle(), (json) => {
    let m
    try {
      m = JSON.parse(json)
    } catch {
      return
    }
    if (m.event === 'property-change' && m.name === 'time-pos') ticks++
    else if (m.event) seen.add(m.event)
  })
  ;['time-pos', 'duration'].forEach((p, i) => addon.observe(i + 1, p))

  // The fixed EmbeddedMpvController.load path: set_property → setProperty,
  // real input commands → command.
  tryProp('start none', 'start', 'none')
  tryCmd('loadfile', ['loadfile', 'av://lavfi:testsrc=size=320x240:rate=30', 'replace'])
  tryProp('pause false->no', 'pause', 'no')

  setTimeout(() => {
    console.log(
      `RESULT events=${[...seen].join(',')} ticks=${ticks} => ` +
        (ticks > 0 && seen.has('file-loaded') ? 'PASS' : 'FAIL')
    )
    addon.destroy()
    win.destroy()
    app.quit()
  }, 3000)
})

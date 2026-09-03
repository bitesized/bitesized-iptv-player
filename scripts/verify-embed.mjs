// Functional verification for the in-process libmpv embed addon. Launches a
// real Electron window, embeds libmpv into it, plays a synthetic source, and
// checks the playback events it receives from the in-process event thread.
//
// It runs the full lifecycle TWICE in one process: create → load → play →
// (assert file-loaded + position ticks) → destroy, then create AGAIN. The
// second create is the regression guard: if teardown
// deadlocked the main thread (the old mpv_terminate_destroy-on-main bug) the
// process would hang here, or the second create would fail because the addon's
// global mpv handle was never cleared. A watchdog fails loudly instead of
// hanging so CI catches a regression.
//
// Run: npx electron scripts/verify-embed.mjs

import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const addonPath = join(root, 'native', 'mpv-embed', 'build', 'Release', 'mpv_embed.node')

const SYNTHETIC_SOURCE = 'av://lavfi:testsrc=size=640x480:rate=30'
const CYCLES = 2
const PLAY_MS = 3000 // let playback run long enough to emit ticks
const WATCHDOG_MS = 20000 // whole run must finish inside this or it's a hang

function fail(reason) {
  console.log(`[verify] RESULT FAIL — ${reason}`)
  process.exit(1)
}

// A hang (e.g. a deadlocked teardown) must fail the run, not block forever.
const watchdog = setTimeout(() => fail('watchdog timeout — likely a teardown hang'), WATCHDOG_MS)

// One create→play→destroy lifecycle. Resolves with what it observed; rejects if
// this cycle never reached playback.
function runCycle(addon, win, cycle) {
  return new Promise((resolve, reject) => {
    const seen = new Set()
    let positions = 0
    let settled = false

    const cycleTimer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`cycle ${cycle}: no playback (events=${[...seen].join(',')})`))
    }, PLAY_MS + 5000)

    addon.create(win.getNativeWindowHandle(), (json) => {
      let msg
      try {
        msg = JSON.parse(json)
      } catch {
        return
      }
      if (msg.event === 'property-change' && msg.name === 'time-pos') {
        positions++
      } else {
        seen.add(msg.event)
      }
    })
    ;['time-pos', 'duration', 'pause', 'track-list', 'eof-reached'].forEach((p, i) =>
      addon.observe(i + 1, p)
    )

    addon.command(['loadfile', SYNTHETIC_SOURCE, 'replace'])
    addon.setProperty('pause', 'no')

    setTimeout(() => {
      if (settled) return
      settled = true
      clearTimeout(cycleTimer)
      const ok = positions > 0 && seen.has('file-loaded')
      console.log(
        `[verify] cycle ${cycle}: events=${[...seen].join(',')} positionTicks=${positions} => ${
          ok ? 'ok' : 'no-playback'
        }`
      )
      // addon.destroy() must return promptly (mpv teardown runs off-thread).
      const before = Date.now()
      addon.destroy()
      const destroyMs = Date.now() - before
      console.log(`[verify] cycle ${cycle}: destroy() returned in ${destroyMs}ms`)
      if (destroyMs > 1000) {
        return reject(
          new Error(`cycle ${cycle}: destroy() blocked ${destroyMs}ms (should be off-thread)`)
        )
      }
      if (!ok) return reject(new Error(`cycle ${cycle}: playback did not start`))
      resolve()
    }, PLAY_MS)
  })
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: true,
    transparent: true,
    backgroundColor: '#00000000'
  })
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<body style="margin:0;background:transparent">' +
          '<div style="position:absolute;bottom:0;width:100%;height:48px;' +
          'background:rgba(0,0,0,.6);color:#fff;font:14px sans-serif;' +
          'display:flex;align-items:center;padding:0 12px">DOM controls overlay</div></body>'
      )
  )

  const addon = require(addonPath)
  console.log('[verify] addon loaded, mpv api', addon.apiVersion())

  try {
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      await runCycle(addon, win, cycle)
      // Give the detached teardown thread + main run loop a moment to drain the
      // cocoa VO's dispatched blocks before the next create reuses the window.
      await new Promise((r) => setTimeout(r, 500))
    }
  } catch (err) {
    return fail(err.message)
  }

  clearTimeout(watchdog)
  console.log(`[verify] RESULT PASS — ${CYCLES} create/destroy cycles completed cleanly`)
  win.destroy()
  app.quit()
  process.exit(0)
})

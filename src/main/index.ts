import { join } from 'node:path'
import { app, BrowserWindow, powerMonitor, session, shell } from 'electron'
import { openDatabase } from './db'
import { ensureDefaultProfile } from './db/repos/profiles'
import { registerIpcHandlers } from './ipc/handlers'
import {
  isEmbeddedMpvAvailable,
  reassertEmbedZOrder
} from './services/player/embeddedMpvController'
import { buildCsp } from './security/csp'
import { EpgService } from './services/epg/epgService'
import { EpgScheduler } from './services/epg/epgScheduler'
import { StreamProxy } from './services/proxy/streamProxy'
import { SyncManager } from './services/syncManager'

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])

// Test isolation: e2e runs point userData at a throwaway directory.
if (process.env['IPTV_USER_DATA']) {
  app.setPath('userData', process.env['IPTV_USER_DATA'])
}

function createWindow(): BrowserWindow {
  // When the in-process libmpv addon embeds video via a native view *below* the
  // web layer, the window must be transparent so the DOM controls float over
  // the video. Each screen paints its own opaque background (see index.css), so
  // only the transparent Player route reveals the video underneath.
  const embedded = isEmbeddedMpvAvailable()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    transparent: embedded,
    backgroundColor: embedded ? '#00000000' : '#0a0a0f',
    // A bare transparent window is frameless (no traffic lights). titleBarStyle
    // 'hidden' keeps the native close/minimise/fullscreen buttons floating over
    // the content *and* preserves transparency, so the embedded video shows
    // through while the window still has real macOS window controls. The DOM
    // reserves the top-left for the buttons and provides a draggable region.
    titleBarStyle: embedded ? 'hidden' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Fullscreen is owned by the app (see the window:setFullscreen handler): tell
  // the renderer whenever it changes — including OS-initiated toggles (the macOS
  // green button / Ctrl+Cmd+F) it didn't request — so the controls stay in sync.
  // After the transition, re-pin the embedded video view below the web layer so
  // the DOM controls stay on top.
  const onFullscreenChange = (fullscreen: boolean): void => {
    if (embedded) reassertEmbedZOrder()
    if (!win.isDestroyed()) win.webContents.send('window:fullscreen', fullscreen)
  }
  win.on('enter-full-screen', () => onFullscreenChange(true))
  win.on('leave-full-screen', () => onFullscreenChange(false))

  // Any external navigation opens in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

void app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev)]
      }
    })
  })

  const dbPath = join(app.getPath('userData'), 'iptv.db')
  const db = openDatabase(dbPath)
  ensureDefaultProfile(db)
  const epgService = new EpgService(db)
  const streamProxy = new StreamProxy()
  await streamProxy.start()
  registerIpcHandlers(db, new SyncManager(db, dbPath, epgService), epgService, streamProxy)

  // Keep the guide fresh: re-ingest XMLTV on a TTL, on a periodic tick, and when
  // the machine wakes from sleep (guide data may have gone stale meanwhile).
  const epgScheduler = new EpgScheduler(db, epgService)
  epgScheduler.start()
  powerMonitor.on('resume', () => epgScheduler.onResume())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

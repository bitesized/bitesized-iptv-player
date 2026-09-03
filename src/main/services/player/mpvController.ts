// mpv process lifecycle + high-level playback control.
// Spawns a bundled or system mpv, embeds into the app window via --wid where
// the platform supports it, and forwards property changes to the renderer as
// typed player events.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { MpvIpcClient } from './mpvIpc'
import type { MpvResponse } from './mpvIpc'
import { MpvEventTranslator } from './mpvEvents'
import type { PlayerEventPayload } from '@shared/player'

const OBSERVED: [number, string][] = [
  [1, 'time-pos'],
  [2, 'duration'],
  [3, 'pause'],
  [4, 'paused-for-cache'],
  [5, 'track-list'],
  [6, 'eof-reached']
]

/** Locate an mpv binary: bundled resources first, then well-known locations. */
export function discoverMpvBinary(): string | null {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  // Dev-tree resources use electron-builder's ${os} naming.
  const osDir =
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
  const candidates = [
    process.env['MPV_PATH'],
    join(process.resourcesPath ?? '', 'mpv', exe),
    join(app.getAppPath(), 'resources', 'mpv', osDir, exe),
    '/opt/homebrew/bin/mpv',
    '/usr/local/bin/mpv',
    '/usr/bin/mpv',
    'C:\\Program Files\\mpv\\mpv.exe'
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Path for mpv's JSON IPC socket.
 *
 * mpv's IPC accepts commands like `run`, so anything that can connect to this
 * socket can execute code as the user. On Unix it therefore goes in a 0700
 * directory under userData rather than the world-listable os.tmpdir(), where
 * a permissive umask would have left it reachable by other local accounts.
 */
export function socketPath(): string {
  const id = randomBytes(8).toString('hex')
  if (process.platform === 'win32') return `\\\\.\\pipe\\iptv-mpv-${id}`

  const dir = join(app.getPath('userData'), 'run')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // recursive:true won't tighten an existing directory, so enforce it.
  chmodSync(dir, 0o700)
  return join(dir, `mpv-${id}.sock`)
}

/**
 * Window id for --wid embedding. HWND (Windows) and XID (X11) are global
 * handles another process can use; macOS NSView* is a process-local pointer —
 * passing it to a separate mpv process is meaningless and can kill mpv at
 * startup, so on macOS mpv opens its own window (until a libmpv render-API
 * addon lands).
 */
export function resolveWid(
  win: Pick<BrowserWindow, 'getNativeWindowHandle'>,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform === 'darwin') return null
  try {
    const handle = win.getNativeWindowHandle()
    return handle.length >= 8
      ? handle.readBigUInt64LE(0).toString()
      : String(handle.readUInt32LE(0))
  } catch {
    return null
  }
}

export function buildMpvArgs(sock: string, wid: string | null): string[] {
  const args = [
    '--idle=yes',
    '--no-config',
    '--no-osc',
    '--no-osd-bar',
    '--no-input-default-bindings',
    '--input-vo-keyboard=no',
    '--keep-open=yes',
    '--force-window=no',
    '--hwdec=auto-safe',
    // Hostile-network tuning.
    '--cache=yes',
    '--cache-secs=30',
    '--demuxer-max-bytes=64MiB',
    '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5',
    '--user-agent=IPTVPlayer/0.1',
    `--input-ipc-server=${sock}`
  ]
  if (wid !== null) args.push(`--wid=${wid}`)
  return args
}

export interface MpvCommandStep {
  args: unknown[]
  /** Failures on optional steps are ignored (option availability varies). */
  optional?: boolean
}

/**
 * The command sequence for loading a stream. mpv ≥ 0.38 changed loadfile's
 * third positional from options to an insertion index, so passing options
 * positionally breaks on modern builds ("invalid parameter"). Instead the
 * resume point is set via the option-property bridge before loading.
 */
export function loadCommandPlan(
  url: string,
  opts: { startSecs?: number; live: boolean }
): MpvCommandStep[] {
  const start =
    opts.startSecs !== undefined && !opts.live && opts.startSecs > 0
      ? `+${Math.floor(opts.startSecs)}`
      : 'none'
  return [
    { args: ['set_property', 'start', start], optional: true },
    { args: ['loadfile', url, 'replace'] },
    { args: ['set_property', 'pause', false] }
  ]
}

export class MpvController {
  private process: ChildProcess | null = null
  private ipc: MpvIpcClient | null = null
  private window: BrowserWindow | null = null
  private readonly translator = new MpvEventTranslator()

  constructor(private readonly binaryPath: string) {}

  get running(): boolean {
    return this.process !== null && this.ipc !== null
  }

  private emit(payload: PlayerEventPayload): void {
    const win = this.window
    if (win && !win.isDestroyed()) {
      win.webContents.send('player:event', payload)
    }
  }

  /** Start mpv attached to (embedded in, where supported) a window. */
  async start(win: BrowserWindow): Promise<void> {
    if (this.running) return
    this.window = win

    const sock = socketPath()
    const args = buildMpvArgs(sock, resolveWid(win))

    // stderr is kept (ring buffer) so an mpv that dies at startup produces an
    // actionable error instead of a bare socket-connect timeout.
    const stderrTail: string[] = []
    let exitCode: number | null | undefined
    let spawnError: Error | null = null

    const child = spawn(this.binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.process = child
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length > 0) stderrTail.push(line.trim())
      }
      while (stderrTail.length > 20) stderrTail.shift()
    })
    child.on('error', (err) => {
      spawnError = err
    })
    child.on('exit', (code) => {
      exitCode = code
      this.emit({ type: 'state', state: 'idle' })
      this.process = null
      this.ipc?.destroy()
      this.ipc = null
    })

    const ipc = new MpvIpcClient()
    try {
      await ipc.connect(sock)
    } catch (err) {
      this.teardownAfterFailedStart()
      // TS doesn't track assignments made inside the child's event callbacks.
      const seenSpawnError = spawnError as Error | null
      const detail = [
        seenSpawnError ? `spawn error: ${seenSpawnError.message}` : null,
        exitCode !== undefined ? `mpv exited with code ${exitCode}` : null,
        stderrTail.length > 0 ? `mpv output: ${stderrTail.slice(-5).join(' | ')}` : null
      ]
        .filter(Boolean)
        .join('; ')
      throw new Error(
        `mpv failed to start${detail ? ` (${detail})` : ''}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    this.ipc = ipc
    ipc.onEvent((event) => this.onMpvEvent(event))
    for (const [id, name] of OBSERVED) {
      await ipc.observeProperty(id, name).catch(() => {})
    }
  }

  private teardownAfterFailedStart(): void {
    this.process?.kill()
    this.process = null
    this.ipc = null
  }

  private onMpvEvent(event: MpvResponse): void {
    for (const payload of this.translator.translate(event)) this.emit(payload)
  }

  async load(url: string, opts: { startSecs?: number; live: boolean }): Promise<void> {
    const ipc = this.requireIpc()
    this.translator.reset()
    for (const step of loadCommandPlan(url, opts)) {
      try {
        await ipc.command(...step.args)
      } catch (err) {
        if (!step.optional) throw err
      }
    }
  }

  async play(): Promise<void> {
    await this.requireIpc().setProperty('pause', false)
  }

  async pause(): Promise<void> {
    await this.requireIpc().setProperty('pause', true)
  }

  async seek(seconds: number): Promise<void> {
    await this.requireIpc().command('seek', seconds, 'absolute')
  }

  async setVolume(volume: number): Promise<void> {
    await this.requireIpc().setProperty('volume', Math.round(volume * 100))
  }

  async setAudioTrack(id: string): Promise<void> {
    await this.requireIpc().setProperty('aid', Number(id))
  }

  async setSubtitle(id: string | null): Promise<void> {
    await this.requireIpc().setProperty('sid', id === null ? 'no' : Number(id))
  }

  async setSubtitleDelay(seconds: number): Promise<void> {
    await this.requireIpc().setProperty('sub-delay', seconds)
  }

  async setSubtitleScale(scale: number): Promise<void> {
    await this.requireIpc().setProperty('sub-scale', scale)
  }

  async addSubtitleFile(path: string): Promise<void> {
    await this.requireIpc().command('sub-add', path, 'select')
  }

  async stop(): Promise<void> {
    await this.requireIpc().command('stop')
  }

  private requireIpc(): MpvIpcClient {
    if (!this.ipc) throw new Error('mpv is not running')
    return this.ipc
  }

  destroy(): void {
    void this.ipc?.command('quit').catch(() => {})
    this.ipc?.destroy()
    this.ipc = null
    this.process?.kill()
    this.process = null
  }
}

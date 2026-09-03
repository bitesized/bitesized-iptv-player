// Integration test against a REAL mpv binary (skipped when none is
// installed). This is the test that would have caught both field failures:
// mpv dying at startup from bad args, and loadfile rejecting positional
// options on mpv ≥ 0.38 ("invalid parameter").

import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlayerEventPayload } from '@shared/player'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    // The IPC socket lives under userData (0700) rather than a shared tmpdir.
    getPath: () => mkdtempSync(join(tmpdir(), 'mpv-int-userdata-'))
  },
  BrowserWindow: class {},
  utilityProcess: {}
}))

const MPV_PATHS = ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv']
const mpvBinary = process.env['MPV_PATH'] ?? MPV_PATHS.find((p) => existsSync(p))

/** One second of silent 8kHz 8-bit mono PCM in a WAV container. */
function writeSilentWav(): string {
  const sampleRate = 8000
  const samples = sampleRate
  const data = Buffer.alloc(samples, 128)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate, 28) // byte rate
  header.writeUInt16LE(1, 32) // block align
  header.writeUInt16LE(8, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  const path = join(mkdtempSync(join(tmpdir(), 'mpv-int-')), 'silence.wav')
  writeFileSync(path, Buffer.concat([header, data]))
  return path
}

describe.skipIf(!mpvBinary)('MpvController against real mpv', () => {
  it(
    'starts, connects over IPC, loads a file with a resume point, and plays',
    { timeout: 30_000 },
    async () => {
      const { MpvController } = await import('@main/services/player/mpvController')

      const events: PlayerEventPayload[] = []
      const fakeWindow = {
        isDestroyed: () => false,
        getNativeWindowHandle: (): Buffer => {
          throw new Error('no native handle in tests')
        },
        webContents: {
          send: (_channel: string, payload: PlayerEventPayload) => events.push(payload)
        }
      }

      const controller = new MpvController(mpvBinary!)
      try {
        // Startup args must not kill mpv (field failure #1: ENOENT socket).
        await controller.start(fakeWindow as never)
        expect(controller.running).toBe(true)

        await controller.setVolume(0)
        // loadfile must be accepted by this mpv's signature (field failure
        // #2: "invalid parameter" on mpv ≥ 0.38), including a resume point.
        await controller.load(writeSilentWav(), { live: false, startSecs: 0.2 })

        // mpv should report progress/state events for the playing file.
        await vi.waitFor(
          () => {
            expect(
              events.some(
                (e) => (e.type === 'state' && e.state === 'playing') || e.type === 'position'
              )
            ).toBe(true)
          },
          { timeout: 15_000, interval: 100 }
        )

        // Command surface stays healthy after a load.
        await controller.pause()
        await controller.play()
      } finally {
        controller.destroy()
      }
    }
  )
})

import { describe, expect, it, vi } from 'vitest'
import { buildMpvArgs, loadCommandPlan, resolveWid } from '@main/services/player/mpvController'

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  BrowserWindow: class {},
  utilityProcess: {}
}))

describe('resolveWid', () => {
  const win = {
    getNativeWindowHandle: () => Buffer.from([0x39, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) // 12345 LE
  }

  it('never embeds on macOS — NSView pointers are process-local', () => {
    expect(resolveWid(win, 'darwin')).toBeNull()
  })

  it('returns the numeric handle on Windows and Linux', () => {
    expect(resolveWid(win, 'win32')).toBe('12345')
    expect(resolveWid(win, 'linux')).toBe('12345')
  })

  it('returns null when the handle is unavailable', () => {
    const broken = {
      getNativeWindowHandle: (): Buffer => {
        throw new Error('no handle')
      }
    }
    expect(resolveWid(broken, 'linux')).toBeNull()
  })
})

describe('buildMpvArgs', () => {
  it('includes the IPC socket, reliability flags, and no default bindings', () => {
    const args = buildMpvArgs('/tmp/sock', null)
    expect(args).toContain('--input-ipc-server=/tmp/sock')
    expect(args).toContain('--cache=yes')
    expect(args.some((a) => a.includes('reconnect=1'))).toBe(true)
    expect(args).toContain('--no-input-default-bindings')
    expect(args.some((a) => a.startsWith('--wid='))).toBe(false)
  })

  it('adds --wid only when a window id exists', () => {
    expect(buildMpvArgs('/tmp/sock', '777')).toContain('--wid=777')
  })
})

describe('loadCommandPlan', () => {
  it('never passes options positionally to loadfile (mpv ≥0.38 regression)', () => {
    // mpv 0.38 changed loadfile's 3rd positional from options to an index;
    // a positional options string makes every load fail: "invalid parameter".
    for (const opts of [{ live: true }, { live: false }, { live: false, startSecs: 90 }]) {
      const loadfile = loadCommandPlan('http://x/s.ts', opts).find((s) => s.args[0] === 'loadfile')!
      expect(loadfile.args).toEqual(['loadfile', 'http://x/s.ts', 'replace'])
    }
  })

  it('sets the resume point via the start option-property, then unpauses', () => {
    const plan = loadCommandPlan('http://x/movie.mkv', { live: false, startSecs: 92.7 })
    expect(plan[0]).toEqual({
      args: ['set_property', 'start', '+92'],
      optional: true
    })
    expect(plan.at(-1)!.args).toEqual(['set_property', 'pause', false])
  })

  it('clears any previous start position for live and fresh plays', () => {
    expect(loadCommandPlan('u', { live: true, startSecs: 50 })[0]!.args).toEqual([
      'set_property',
      'start',
      'none'
    ])
    expect(loadCommandPlan('u', { live: false })[0]!.args).toEqual([
      'set_property',
      'start',
      'none'
    ])
  })
})

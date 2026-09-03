import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { MpvIpcClient } from '@main/services/player/mpvIpc'

interface ReceivedCommand {
  command: unknown[]
  request_id: number
}

describe('MpvIpcClient', () => {
  let server: Server
  let socketPath: string
  let serverSocket: Socket | null
  let received: ReceivedCommand[]
  let waiters: ((cmd: ReceivedCommand) => void)[]
  let client: MpvIpcClient

  function nextCommand(): Promise<ReceivedCommand> {
    const existing = received.shift()
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => waiters.push(resolve))
  }

  function respond(requestId: number, error: string, data: unknown = null): void {
    serverSocket!.write(`${JSON.stringify({ request_id: requestId, error, data })}\n`)
  }

  beforeEach(async () => {
    // Mirror production (mpvController.ts::socketPath): Windows IPC is a named
    // pipe, not a filesystem AF_UNIX socket — listen() on a *.sock path there
    // fails with EACCES.
    const id = randomBytes(4).toString('hex')
    socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\mpv-test-${id}`
        : join(tmpdir(), `mpv-test-${id}.sock`)
    received = []
    waiters = []
    serverSocket = null
    // Resolves when the server has accepted the client and assigned
    // serverSocket. connect() can resolve before the server's connection
    // callback runs (notably on Windows named pipes), so tests that write from
    // the server first (without any client→server traffic to sync on) would hit
    // a null serverSocket — awaiting this in setup makes it deterministic.
    let markConnected!: () => void
    const serverConnected = new Promise<void>((resolve) => (markConnected = resolve))
    server = createServer((socket) => {
      serverSocket = socket
      markConnected()
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          const message = JSON.parse(line) as ReceivedCommand
          const waiter = waiters.shift()
          if (waiter) waiter(message)
          else received.push(message)
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    client = new MpvIpcClient()
    await client.connect(socketPath)
    await serverConnected
  })

  afterEach(() => {
    // Guard so a failed setup (e.g. listen error) doesn't mask it with a
    // confusing "cannot read properties of undefined" from teardown.
    client?.destroy()
    server?.close()
  })

  it('sends commands and resolves matching responses (even out of order)', async () => {
    const first = client.setProperty('pause', true)
    const second = client.command('loadfile', 'http://x/stream.ts', 'replace', '')
    const cmd1 = await nextCommand()
    const cmd2 = await nextCommand()
    expect(cmd1.command).toEqual(['set_property', 'pause', true])
    expect(cmd2.command).toEqual(['loadfile', 'http://x/stream.ts', 'replace', ''])

    // Respond out of order — each promise must still get its own response.
    respond(cmd2.request_id, 'success', 'loaded')
    respond(cmd1.request_id, 'success', 'paused')
    await expect(second).resolves.toBe('loaded')
    await expect(first).resolves.toBe('paused')
  })

  it('rejects when mpv reports an error', async () => {
    const promise = client.getProperty('nonexistent')
    const cmd = await nextCommand()
    respond(cmd.request_id, 'property not found')
    await expect(promise).rejects.toThrow(/property not found/)
  })

  it('dispatches mpv events to handlers', async () => {
    const events: unknown[] = []
    client.onEvent((event) => events.push(event))
    serverSocket!.write(
      `${JSON.stringify({ event: 'property-change', id: 1, name: 'time-pos', data: 42.5 })}\n` +
        `${JSON.stringify({ event: 'file-loaded' })}\n`
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(events).toEqual([
      { event: 'property-change', id: 1, name: 'time-pos', data: 42.5 },
      { event: 'file-loaded' }
    ])
  })

  it('handles partial/split JSON lines', async () => {
    const events: unknown[] = []
    client.onEvent((event) => events.push(event))
    const payload = `${JSON.stringify({ event: 'seek' })}\n`
    serverSocket!.write(payload.slice(0, 5))
    await new Promise((r) => setTimeout(r, 20))
    serverSocket!.write(payload.slice(5))
    await new Promise((r) => setTimeout(r, 50))
    expect(events).toEqual([{ event: 'seek' }])
  })

  it('fails pending requests when the socket closes', async () => {
    const promise = client.command('get_property', 'volume')
    await nextCommand()
    serverSocket!.destroy()
    await expect(promise).rejects.toThrow()
  })
})

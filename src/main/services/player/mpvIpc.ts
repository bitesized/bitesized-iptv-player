// Minimal client for mpv's JSON IPC protocol (newline-delimited JSON over a
// unix socket / named pipe). Kept free of process/spawn concerns so the
// protocol can be unit-tested against a fake server.

import { createConnection } from 'node:net'
import type { Socket } from 'node:net'

export interface MpvResponse {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  id?: number
  name?: string
  reason?: string
  [key: string]: unknown
}

export type MpvEventHandler = (event: MpvResponse) => void

const CONNECT_RETRIES = 40
const CONNECT_RETRY_MS = 250

export class MpvIpcClient {
  private socket: Socket | null = null
  private buffer = ''
  private nextRequestId = 1
  private readonly pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  >()
  private readonly eventHandlers = new Set<MpvEventHandler>()

  /** Connect, retrying while mpv creates the socket after spawn. */
  async connect(socketPath: string): Promise<void> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < CONNECT_RETRIES; attempt++) {
      try {
        await this.tryConnect(socketPath)
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS))
      }
    }
    throw new Error(`Could not connect to mpv IPC socket: ${lastError?.message}`)
  }

  private tryConnect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath)
      socket.once('connect', () => {
        this.socket = socket
        socket.on('data', (chunk) => this.onData(chunk.toString('utf8')))
        socket.on('close', () => this.failAllPending(new Error('mpv IPC socket closed')))
        socket.on('error', () => {})
        resolve()
      })
      socket.once('error', (err) => {
        socket.destroy()
        reject(err)
      })
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line.length === 0) continue
      let message: MpvResponse
      try {
        message = JSON.parse(line) as MpvResponse
      } catch {
        continue
      }
      if (message.request_id !== undefined && this.pending.has(message.request_id)) {
        const { resolve, reject } = this.pending.get(message.request_id)!
        this.pending.delete(message.request_id)
        if (message.error === 'success') resolve(message.data)
        else reject(new Error(`mpv: ${message.error ?? 'unknown error'}`))
      } else if (message.event) {
        for (const handler of this.eventHandlers) handler(message)
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }

  onEvent(handler: MpvEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  command(...args: unknown[]): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error('mpv IPC not connected'))
    }
    const requestId = this.nextRequestId++
    const payload = JSON.stringify({ command: args, request_id: requestId })
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      socket.write(`${payload}\n`, (err) => {
        if (err) {
          this.pending.delete(requestId)
          reject(err)
        }
      })
    })
  }

  setProperty(name: string, value: unknown): Promise<unknown> {
    return this.command('set_property', name, value)
  }

  getProperty(name: string): Promise<unknown> {
    return this.command('get_property', name)
  }

  observeProperty(observeId: number, name: string): Promise<unknown> {
    return this.command('observe_property', observeId, name)
  }

  destroy(): void {
    this.failAllPending(new Error('mpv IPC client destroyed'))
    this.socket?.destroy()
    this.socket = null
  }
}

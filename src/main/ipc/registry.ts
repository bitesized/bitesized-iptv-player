import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type {
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse
} from '@shared/contracts'

type Handler<C extends IpcChannel> = (
  payload: IpcRequest<C>
) => IpcResponse<C> | Promise<IpcResponse<C>>

const registered = new Set<string>()

/** Register a typed ipcMain.handle for a contract channel. */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  if (registered.has(channel)) {
    throw new Error(`IPC channel already registered: ${channel}`)
  }
  registered.add(channel)
  ipcMain.handle(channel, (_event, payload) => handler(payload as IpcRequest<C>))
}

/** Push a typed fire-and-forget event to a renderer window. */
export function emit<C extends IpcEventChannel>(
  win: BrowserWindow,
  channel: C,
  payload: IpcEventPayload<C>
): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

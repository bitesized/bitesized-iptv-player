import { contextBridge, ipcRenderer } from 'electron'
import type { RendererApi } from '@shared/contracts'

// The only surface the renderer gets. Channels are typed via IpcContracts;
// anything not in the contract map simply isn't reachable from the UI.
const api: RendererApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      listener(payload as never)
    }
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)

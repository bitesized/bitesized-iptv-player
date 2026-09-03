import type { IpcChannel, IpcRequest, IpcResponse, RendererApi } from '@shared/contracts'

/**
 * Typed access to the preload bridge. All renderer data access goes through
 * here — never fetch provider hosts directly from the UI.
 */
export const api: RendererApi = window.api

export function invoke<C extends IpcChannel>(
  channel: C,
  payload: IpcRequest<C>
): Promise<IpcResponse<C>> {
  return api.invoke(channel, payload)
}

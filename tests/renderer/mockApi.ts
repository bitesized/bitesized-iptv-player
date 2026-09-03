// A fake preload bridge for renderer tests. Every contract channel resolves
// to an empty-but-well-typed default; individual tests override channels via
// mockChannel(). Unhandled channels throw, so a screen invoking a channel the
// test didn't anticipate fails loudly instead of hanging.

import type {
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
  RendererApi
} from '@shared/contracts'

type AnyHandler = (payload: never) => unknown

const overrides = new Map<IpcChannel, AnyHandler>()
const eventListeners = new Map<string, Set<(payload: never) => void>>()

const emptyPage = { items: [], nextCursor: null }

const defaults: { [C in IpcChannel]: (payload: IpcRequest<C>) => IpcResponse<C> } = {
  'app:version': () => '0.0.0-test',
  'providers:list': () => [],
  'providers:addXtream': () => {
    throw new Error('providers:addXtream not mocked')
  },
  'providers:addM3u': () => {
    throw new Error('providers:addM3u not mocked')
  },
  'providers:delete': () => undefined,
  'providers:sync': () => undefined,
  'providers:setEpgUrl': () => undefined,
  'providers:refreshEpg': () => ({ programmes: 0 }),
  'dialog:pickPlaylist': () => null,
  'categories:list': () => [],
  'categories:setHidden': () => undefined,
  'categories:reorder': () => undefined,
  'channels:page': () => emptyPage,
  'channels:adjacent': () => ({ prevId: null, nextId: null }),
  'vod:page': () => emptyPage,
  'vod:detail': () => {
    throw new Error('vod:detail not mocked')
  },
  'series:page': () => emptyPage,
  'series:detail': () => {
    throw new Error('series:detail not mocked')
  },
  'vod:subtitles': () => ({ subtitles: [] }),
  'series:episodes': () => [],
  'episodes:next': () => ({ nextEpisodeId: null }),
  'stream:url': () => ({
    url: 'http://127.0.0.1:1/s/test.mp4',
    containerExt: 'mp4',
    providerId: 1
  }),
  'stream:timeshift': () => ({
    url: 'http://127.0.0.1:1/s/ts.ts',
    containerExt: 'ts',
    providerId: 1
  }),
  'search:query': () => emptyPage,
  'profiles:list': () => [{ id: 1, name: 'Default', avatar: null, isKids: false, hasPin: false }],
  'profiles:create': () => {
    throw new Error('profiles:create not mocked')
  },
  'profiles:delete': () => undefined,
  'profiles:verifyPin': () => ({ ok: true }),
  'favorites:toggle': () => ({ favorited: true }),
  'favorites:list': () => [],
  'favorites:detailed': () => [],
  'history:upsert': () => undefined,
  'history:remove': () => undefined,
  'history:position': () => null,
  'history:continueWatching': () => [],
  'epg:window': () => [],
  'epg:hydrate': () => undefined,
  'epg:nowNext': () => [],
  'settings:get': () => null,
  'settings:set': () => undefined,
  'player:capabilities': () => ({ engine: 'web', embedded: false }),
  'player:load': () => undefined,
  'player:command': () => undefined,
  'player:stop': () => undefined,
  'window:setFullscreen': () => undefined,
  'window:isFullscreen': () => false
}

/** Override one channel for the current test. Cleared by resetMockApi(). */
export function mockChannel<C extends IpcChannel>(
  channel: C,
  handler: (payload: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>
): void {
  overrides.set(channel, handler as AnyHandler)
}

export function resetMockApi(): void {
  overrides.clear()
  eventListeners.clear()
}

/** Push a fake main→renderer event to subscribed components. */
export function emitEvent<C extends IpcEventChannel>(
  channel: C,
  payload: IpcEventPayload<C>
): void {
  for (const listener of eventListeners.get(channel) ?? []) {
    listener(payload as never)
  }
}

export function installMockApi(): void {
  const api: RendererApi = {
    invoke: async (channel, payload) => {
      const handler = overrides.get(channel) ?? defaults[channel]
      return (await (handler as AnyHandler)(payload as never)) as never
    },
    on: (channel, listener) => {
      const set = eventListeners.get(channel) ?? new Set()
      set.add(listener as (payload: never) => void)
      eventListeners.set(channel, set)
      return () => set.delete(listener as (payload: never) => void)
    }
  }
  ;(window as unknown as { api: RendererApi }).api = api
}

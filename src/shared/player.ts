// Player types shared between the mpv bridge (main) and the renderer.

/**
 * Marker embedded in the message of a connection-limit playback failure. IPC
 * strips an Error's `name`/`code` (only the message survives the main→renderer
 * hop), so both sides key off this substring to recognise the state.
 */
export const CONNECTION_LIMIT_MARKER = '[CONNECTION_LIMIT]'

export interface PlayerTrack {
  id: string
  label: string
  language: string | null
  selected: boolean
}

export type PlayerBridgeState = 'idle' | 'playing' | 'paused' | 'buffering' | 'error'

export type PlayerEventPayload =
  | { type: 'position'; position: number }
  | { type: 'duration'; duration: number | null }
  | { type: 'state'; state: PlayerBridgeState; error?: string }
  | { type: 'tracks'; audio: PlayerTrack[]; subtitles: PlayerTrack[] }
  | { type: 'ended' }

export type PlayerCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; seconds: number }
  | { action: 'setVolume'; volume: number }
  | { action: 'setAudioTrack'; trackId: string }
  | { action: 'setSubtitle'; trackId: string | null }
  | { action: 'setSubtitleDelay'; seconds: number }
  | { action: 'setSubtitleScale'; scale: number }
  | { action: 'addSubtitleFile'; path: string }
  | { action: 'stop' }

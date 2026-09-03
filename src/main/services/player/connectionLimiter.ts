// Per-provider concurrent-connection queue for stream opens (TODO P1).
//
// Xtream panels cap how many streams an account may open at once
// (`max_connections`); exceeding it yields spurious playback failures or, on
// stricter panels, a temporary ban. This serialises opens per provider and
// refuses (rather than silently overshoots) once a provider is at its cap, so
// the UI can show a clear "connection limit reached" state.
//
// Pure of Electron so it unit-tests in isolation; the caller supplies a
// `maxFor(providerId)` that reads the persisted cap (null = unknown/unlimited).

import { CONNECTION_LIMIT_MARKER } from '@shared/player'

/** Thrown by `acquire` when a provider is already at its connection cap. The
 * message carries {@link CONNECTION_LIMIT_MARKER} so the renderer can recognise
 * it after IPC drops the error's name/code. */
export class ConnectionLimitError extends Error {
  readonly code = 'CONNECTION_LIMIT' as const
  constructor(readonly max: number) {
    super(
      `${CONNECTION_LIMIT_MARKER} Connection limit reached — this provider allows ${max} simultaneous ${
        max === 1 ? 'stream' : 'streams'
      }. Stop another stream and try again.`
    )
    this.name = 'ConnectionLimitError'
  }
}

/** Release the slot held by a successful `acquire`. Idempotent. */
export type ConnectionRelease = () => void

export class ConnectionLimiter {
  private readonly held = new Map<number, number>()

  /** @param maxFor current cap for a provider; null/≤0 means uncapped. */
  constructor(private readonly maxFor: (providerId: number) => number | null) {}

  /** Slots currently held for a provider (test/inspection aid). */
  activeCount(providerId: number): number {
    return this.held.get(providerId) ?? 0
  }

  /**
   * Reserve a connection slot for a provider. Resolves with a release handle,
   * or throws {@link ConnectionLimitError} when the provider is already at its
   * cap. Uncapped providers (unknown/≤0) always succeed.
   */
  acquire(providerId: number): ConnectionRelease {
    const max = this.maxFor(providerId)
    const active = this.held.get(providerId) ?? 0
    if (max !== null && max > 0 && active >= max) {
      throw new ConnectionLimitError(max)
    }
    this.held.set(providerId, active + 1)

    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.held.get(providerId) ?? 1) - 1
      if (remaining <= 0) this.held.delete(providerId)
      else this.held.set(providerId, remaining)
    }
  }
}

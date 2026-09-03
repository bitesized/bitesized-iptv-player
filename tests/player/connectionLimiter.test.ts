import { describe, expect, it } from 'vitest'
import { ConnectionLimiter, ConnectionLimitError } from '@main/services/player/connectionLimiter'
import { CONNECTION_LIMIT_MARKER } from '@shared/player'

describe('ConnectionLimiter', () => {
  it('allows opens up to the provider cap, then refuses', () => {
    const limiter = new ConnectionLimiter(() => 2)
    const a = limiter.acquire(1)
    const b = limiter.acquire(1)
    expect(limiter.activeCount(1)).toBe(2)
    expect(() => limiter.acquire(1)).toThrow(ConnectionLimitError)
    // Freeing a slot lets the next open through.
    a()
    expect(limiter.activeCount(1)).toBe(1)
    const c = limiter.acquire(1)
    expect(limiter.activeCount(1)).toBe(2)
    b()
    c()
    expect(limiter.activeCount(1)).toBe(0)
  })

  it('treats unknown / non-positive caps as unlimited', () => {
    for (const cap of [null, 0, -1]) {
      const limiter = new ConnectionLimiter(() => cap)
      const releases = Array.from({ length: 5 }, () => limiter.acquire(7))
      expect(limiter.activeCount(7)).toBe(5)
      releases.forEach((r) => r())
    }
  })

  it('tracks each provider independently', () => {
    const caps = new Map([
      [1, 1],
      [2, 1]
    ])
    const limiter = new ConnectionLimiter((id) => caps.get(id) ?? null)
    limiter.acquire(1)
    // Provider 2 is unaffected by provider 1 being maxed.
    expect(() => limiter.acquire(1)).toThrow(ConnectionLimitError)
    expect(() => limiter.acquire(2)).not.toThrow()
  })

  it('release is idempotent — double free does not undercount', () => {
    const limiter = new ConnectionLimiter(() => 1)
    const release = limiter.acquire(1)
    release()
    release()
    expect(limiter.activeCount(1)).toBe(0)
    // A held slot from a different open is not clobbered by the stale release.
    limiter.acquire(1)
    release()
    expect(limiter.activeCount(1)).toBe(1)
  })

  it('re-reads the cap on each acquire (picks up a later sync)', () => {
    let cap: number | null = null
    const limiter = new ConnectionLimiter(() => cap)
    limiter.acquire(1)
    limiter.acquire(1) // still unlimited
    cap = 2
    expect(() => limiter.acquire(1)).toThrow(ConnectionLimitError) // now at cap (2)
  })

  it('error message carries the marker the renderer keys off', () => {
    const limiter = new ConnectionLimiter(() => 1)
    limiter.acquire(1)
    try {
      limiter.acquire(1)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionLimitError)
      expect((err as Error).message).toContain(CONNECTION_LIMIT_MARKER)
      expect((err as ConnectionLimitError).max).toBe(1)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'
import { listCategories, pageChannels, search } from '@main/db/repos/browse'
import {
  createProfile,
  ensureDefaultProfile,
  hashPin,
  verifyPin,
  verifyProfilePin
} from '@main/db/repos/profiles'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  db.prepare("INSERT INTO providers (id, type, name) VALUES (1, 'xtream', 'Test')").run()
  return db
}

describe('PIN hashing', () => {
  it('verifies correct PINs and rejects wrong ones', () => {
    const stored = hashPin('1234')
    expect(verifyPin('1234', stored)).toBe(true)
    expect(verifyPin('4321', stored)).toBe(false)
  })

  it('salts hashes (same PIN → different hashes)', () => {
    expect(hashPin('1234')).not.toBe(hashPin('1234'))
  })

  it('uses a deliberately slow KDF, not a bare digest', () => {
    // A 4-digit PIN is 10k candidates; a fast hash makes the DB file enough to
    // recover it. The versioned prefix is what verifyPin dispatches on.
    const stored = hashPin('1234')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(stored).not.toMatch(/^[a-f0-9]{16}:[a-f0-9]{64}$/)
  })

  it('still verifies legacy salt:sha256 hashes', () => {
    const legacy = createHash('sha256').update('abcd:1234').digest('hex')
    expect(verifyPin('1234', `abcd:${legacy}`)).toBe(true)
    expect(verifyPin('9999', `abcd:${legacy}`)).toBe(false)
  })

  it('upgrades a legacy hash in place once the PIN is entered correctly', () => {
    const db = openTestDb()
    const profile = createProfile(db, { name: 'L', avatar: null, isKids: false, pin: null })
    const legacy = createHash('sha256').update('abcd:1234').digest('hex')
    db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(`abcd:${legacy}`, profile.id)

    expect(verifyProfilePin(db, profile.id, '9999')).toBe(false)
    const unchanged = db.prepare('SELECT pin_hash FROM profiles WHERE id = ?').get(profile.id) as {
      pin_hash: string
    }
    expect(unchanged.pin_hash.startsWith('scrypt$')).toBe(false)

    expect(verifyProfilePin(db, profile.id, '1234')).toBe(true)
    const upgraded = db.prepare('SELECT pin_hash FROM profiles WHERE id = ?').get(profile.id) as {
      pin_hash: string
    }
    expect(upgraded.pin_hash.startsWith('scrypt$')).toBe(true)
    // And the upgraded hash still verifies.
    expect(verifyProfilePin(db, profile.id, '1234')).toBe(true)
  })

  it('verifyProfilePin: profiles without a PIN always pass', () => {
    const db = openTestDb()
    const noPin = createProfile(db, { name: 'A', avatar: null, isKids: false, pin: null })
    const withPin = createProfile(db, { name: 'B', avatar: null, isKids: false, pin: '9999' })
    expect(verifyProfilePin(db, noPin.id, 'anything')).toBe(true)
    expect(verifyProfilePin(db, withPin.id, '9999')).toBe(true)
    expect(verifyProfilePin(db, withPin.id, '0000')).toBe(false)
  })
})

describe('ensureDefaultProfile', () => {
  it('creates one profile and is idempotent', () => {
    const db = openTestDb()
    const first = ensureDefaultProfile(db)
    const second = ensureDefaultProfile(db)
    expect(first).toBe(second)
    const count = db.prepare('SELECT COUNT(*) n FROM profiles').get() as { n: number }
    expect(count.n).toBe(1)
  })
})

describe('kids profile filtering', () => {
  function seed(db: Database.Database): { kidsId: number; adultCatId: number } {
    const kids = createProfile(db, { name: 'Kid', avatar: null, isKids: true, pin: null })
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (1, 1, 'live', 'r1', 'News')"
    ).run()
    db.prepare(
      "INSERT INTO categories (id, provider_id, kind, remote_id, name) VALUES (2, 1, 'live', 'r2', 'Adults XXX')"
    ).run()
    db.prepare(
      "INSERT INTO channels (provider_id, category_id, stream_id, name) VALUES (1, 1, 'a', 'Safe Channel')"
    ).run()
    db.prepare(
      "INSERT INTO channels (provider_id, category_id, stream_id, name) VALUES (1, 2, 'b', 'Bad Channel')"
    ).run()
    return { kidsId: kids.id, adultCatId: 2 }
  }

  it('hides adult categories from category lists', () => {
    const db = openTestDb()
    const { kidsId } = seed(db)
    expect(listCategories(db, 'live').map((c) => c.name)).toContain('Adults XXX')
    expect(listCategories(db, 'live', undefined, kidsId).map((c) => c.name)).toEqual(['News'])
  })

  it('hides adult items from browse pages and search', () => {
    const db = openTestDb()
    const { kidsId } = seed(db)

    const all = pageChannels(db, { cursor: null, limit: 10 })
    expect(all.items).toHaveLength(2)
    const filtered = pageChannels(db, { cursor: null, limit: 10, profileId: kidsId })
    expect(filtered.items.map((c) => c.name)).toEqual(['Safe Channel'])

    const found = search(db, {
      term: 'channel',
      kind: 'live',
      cursor: null,
      limit: 10,
      profileId: kidsId
    })
    expect(found.items.map((c) => c.name)).toEqual(['Safe Channel'])
  })
})

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AppDatabase } from '@main/db'
import type { Profile } from '@shared/types'

// A parental PIN is typically four digits — only 10k candidates — so the hash
// has to be slow enough that reading the DB file doesn't hand over the PIN. The
// stored format is versioned: `scrypt$N$r$p$salt$hash`.
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

interface ProfileDbRow {
  id: number
  name: string
  avatar: string | null
  is_kids: number
  pin_hash: string | null
}

function toProfile(row: ProfileDbRow): Profile {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    isKids: row.is_kids !== 0,
    hasPin: row.pin_hash !== null
  }
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const digest = scryptSync(pin, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${digest}`
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Verify against either the current scrypt format or the original
 * `salt:sha256` one, so PINs set by an earlier build keep working.
 * `needsRehash` below drives the transparent upgrade.
 */
export function verifyPin(pin: string, stored: string): boolean {
  if (stored.startsWith('scrypt$')) {
    const [, n, r, p, salt, digest] = stored.split('$')
    if (!n || !r || !p || !salt || !digest) return false
    const computed = scryptSync(pin, salt, digest.length / 2, {
      N: Number(n),
      r: Number(r),
      p: Number(p)
    }).toString('hex')
    return constantTimeEquals(computed, digest)
  }

  const [salt, digest] = stored.split(':')
  if (!salt || !digest) return false
  const computed = createHash('sha256').update(`${salt}:${pin}`).digest('hex')
  return constantTimeEquals(computed, digest)
}

/** True for hashes still in the legacy fast-SHA format. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith('scrypt$')
}

export function listProfiles(db: AppDatabase): Profile[] {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY id').all() as ProfileDbRow[]
  return rows.map(toProfile)
}

export function createProfile(
  db: AppDatabase,
  input: { name: string; avatar: string | null; isKids: boolean; pin: string | null }
): Profile {
  const result = db
    .prepare('INSERT INTO profiles (name, avatar, is_kids, pin_hash) VALUES (?, ?, ?, ?)')
    .run(input.name, input.avatar, input.isKids ? 1 : 0, input.pin ? hashPin(input.pin) : null)
  const row = db
    .prepare('SELECT * FROM profiles WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ProfileDbRow
  return toProfile(row)
}

export function deleteProfile(db: AppDatabase, id: number): void {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
}

export function verifyProfilePin(db: AppDatabase, id: number, pin: string): boolean {
  const row = db.prepare('SELECT pin_hash FROM profiles WHERE id = ?').get(id) as
    { pin_hash: string | null } | undefined
  if (!row) return false
  if (row.pin_hash === null) return true
  if (!verifyPin(pin, row.pin_hash)) return false
  // A correct PIN is the only moment the plaintext is available, so it's also
  // the only chance to migrate a legacy hash to scrypt without asking the user.
  if (needsRehash(row.pin_hash)) {
    db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(hashPin(pin), id)
  }
  return true
}

export function isKidsProfile(db: AppDatabase, id: number | undefined): boolean {
  if (id === undefined) return false
  const row = db.prepare('SELECT is_kids FROM profiles WHERE id = ?').get(id) as
    { is_kids: number } | undefined
  return row?.is_kids === 1
}

/** Guarantee at least one profile exists; returns the first profile's id. */
export function ensureDefaultProfile(db: AppDatabase): number {
  const existing = db.prepare('SELECT id FROM profiles ORDER BY id LIMIT 1').get() as
    { id: number } | undefined
  if (existing) return existing.id
  return createProfile(db, { name: 'Default', avatar: null, isKids: false, pin: null }).id
}

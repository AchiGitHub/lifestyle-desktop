import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { passwordInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { settings } from '../db/schema'

const KEY = 'auth.passwordHash'

function readHash(db: Db): string | null {
  return db.select().from(settings).where(eq(settings.key, KEY)).get()?.value ?? null
}

export function hasPassword(db: Db): boolean {
  return readHash(db) !== null
}

export function verifyPassword(db: Db, password: string): boolean {
  const stored = readHash(db)
  if (!stored) return false
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(expected, actual)
}

export function setPassword(db: Db, password: string): void {
  const valid = passwordInput.parse(password)
  const salt = randomBytes(16)
  const value = `scrypt$${salt.toString('hex')}$${scryptSync(valid, salt, 64).toString('hex')}`
  db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
}

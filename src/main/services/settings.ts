import { eq, inArray } from 'drizzle-orm'
import type { Executor } from '../db/client'
import { settings } from '../db/schema'

export function readSettings(db: Executor, keys: string[]): Map<string, string> {
  if (keys.length === 0) return new Map()
  return new Map(
    db
      .select()
      .from(settings)
      .where(inArray(settings.key, keys))
      .all()
      .map((s) => [s.key, s.value])
  )
}

/** Saves a setting; null removes it, so the default applies again. */
export function putSetting(db: Executor, key: string, value: string | null): void {
  if (value === null) {
    db.delete(settings).where(eq(settings.key, key)).run()
  } else {
    db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
  }
}

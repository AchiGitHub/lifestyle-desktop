import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'
import { upgradeData } from './upgrades'

export type Db = BetterSQLite3Database<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** Either the database or an open transaction on it. */
export type Executor = Db | Tx

export interface Connection {
  sqlite: Database.Database
  db: Db
}

export function openDatabase(file: string, migrationsFolder: string): Connection {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  db.transaction((tx) => upgradeData(tx))
  return { sqlite, db }
}

export interface DbCheck {
  ok: boolean
  reason?: string
  appliedMigrations: number
}

/**
 * Checks a database file before it replaces the live one: it must be a
 * healthy SQLite file made by this app, and not by a newer version of it.
 */
export function checkDatabaseFile(file: string, knownMigrations: number): DbCheck {
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true })
    const integrity = sqlite.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') return { ok: false, reason: 'The file is damaged.', appliedMigrations: 0 }
    const tables = new Set(
      (sqlite.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map(
        (r) => r.name
      )
    )
    if (!tables.has('members') || !tables.has('__drizzle_migrations')) {
      return { ok: false, reason: "This isn't a Lifestyle database.", appliedMigrations: 0 }
    }
    const applied = (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n
    if (applied > knownMigrations) {
      return {
        ok: false,
        reason: 'This backup was made by a newer version of the app. Install the latest version first.',
        appliedMigrations: applied
      }
    }
    return { ok: true, appliedMigrations: applied }
  } catch (e) {
    return { ok: false, reason: `Couldn't open the file: ${(e as Error).message}`, appliedMigrations: 0 }
  } finally {
    sqlite?.close()
  }
}

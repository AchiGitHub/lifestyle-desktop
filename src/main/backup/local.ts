import type Database from 'better-sqlite3'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalBackup } from '../../shared/api'

const KEEP = { daily: 14, 'before-restore': 5, 'before-update': 3 } as const
type Kind = keyof typeof KEEP

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Online backup: a consistent copy even while the app is writing. */
export async function snapshot(sqlite: Database.Database, dir: string, kind: Kind): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `lifestyle_${stamp()}_${kind}.db`)
  await sqlite.backup(file)
  prune(dir, kind)
  return file
}

/** One daily snapshot is enough; skip if today's already exists. */
export async function dailySnapshot(sqlite: Database.Database, dir: string): Promise<void> {
  const today = stamp().slice(0, 10)
  if (listLocalBackups(dir).some((b) => b.name.startsWith(`lifestyle_${today}`) && b.name.endsWith('_daily.db'))) return
  await snapshot(sqlite, dir, 'daily')
}

function prune(dir: string, kind: Kind): void {
  const files = listLocalBackups(dir).filter((b) => b.name.endsWith(`_${kind}.db`))
  for (const old of files.slice(KEEP[kind])) rmSync(join(dir, old.name), { force: true })
}

/** Newest first. */
export function listLocalBackups(dir: string): LocalBackup[] {
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.startsWith('lifestyle_') && n.endsWith('.db'))
  } catch {
    return []
  }
  return names
    .map((name) => {
      const s = statSync(join(dir, name))
      return { name, size: s.size, createdAt: s.mtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

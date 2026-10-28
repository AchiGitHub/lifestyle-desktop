import { dialog } from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { BackupStatus, DriveBackup } from '../../shared/api'
import { checkDatabaseFile } from '../db/client'
import { readConfig, updateConfig } from '../config'
import { paths } from '../paths'
import { AppError } from '../services/errors'
import { closeDb, conn, openDb, setAuthenticated } from '../state'
import * as drive from './drive'
import { listLocalBackups, snapshot } from './local'

const DAY_MS = 24 * 60 * 60 * 1000
let running = false

/** Local time, e.g. 2026-10-27_1730. */
function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function backupStatus(): BackupStatus {
  const config = readConfig()
  return {
    dbPath: paths.db,
    driveConfigured: drive.driveConfigured(),
    driveConnected: Boolean(config.drive),
    driveAccount: config.drive?.account ?? null,
    lastBackupAt: config.backup?.lastSuccessAt ?? null,
    lastAttemptAt: config.backup?.lastAttemptAt ?? null,
    lastError: config.backup?.lastError ?? null,
    running,
    localBackups: listLocalBackups(paths.backups)
  }
}

/** True when Drive is connected and the last good backup is over a day old. */
export function backupDue(): boolean {
  const config = readConfig()
  if (!config.drive || !drive.driveConfigured()) return false
  const last = config.backup?.lastSuccessAt
  return !last || Date.now() - Date.parse(last) > DAY_MS
}

export async function backupNow(): Promise<void> {
  if (running) throw new AppError('A backup is already running.')
  running = true
  updateConfig((c) => {
    c.backup = { ...c.backup, lastAttemptAt: new Date().toISOString() }
  })
  const tmp = join(tmpdir(), `lifestyle-upload-${Date.now()}.db`)
  try {
    await conn().sqlite.backup(tmp)
    await drive.upload(tmp, `lifestyle_${stamp()}.db`)
    updateConfig((c) => {
      c.backup = { ...c.backup, lastSuccessAt: new Date().toISOString(), lastError: null }
    })
  } catch (e) {
    updateConfig((c) => {
      c.backup = { ...c.backup, lastError: (e as Error).message }
    })
    throw e
  } finally {
    running = false
    rmSync(tmp, { force: true })
  }
}

function bundledMigrations(): number {
  const journal = JSON.parse(readFileSync(join(paths.migrations, 'meta', '_journal.json'), 'utf8'))
  return journal.entries.length
}

/**
 * Replaces the live database with `source`, after checking it and keeping a
 * safety copy of the current data. Signs the user out: the restored data
 * brings its own password.
 */
async function restoreFromPath(source: string): Promise<void> {
  const check = checkDatabaseFile(source, bundledMigrations())
  if (!check.ok) throw new AppError(check.reason ?? 'That file can’t be restored.')

  await snapshot(conn().sqlite, paths.backups, 'before-restore')
  const incoming = `${paths.db}.restoring`
  copyFileSync(source, incoming)
  closeDb()
  try {
    for (const suffix of ['-wal', '-shm']) rmSync(`${paths.db}${suffix}`, { force: true })
    renameSync(incoming, paths.db)
  } finally {
    rmSync(incoming, { force: true })
    openDb() // also brings an older backup's schema up to date
  }
  setAuthenticated(false)
}

export async function restoreFromFile(): Promise<boolean> {
  const picked = await dialog.showOpenDialog({
    title: 'Choose a Lifestyle backup',
    properties: ['openFile'],
    filters: [{ name: 'Lifestyle database', extensions: ['db', 'sqlite'] }]
  })
  if (picked.canceled || picked.filePaths.length === 0) return false
  await restoreFromPath(picked.filePaths[0])
  return true
}

export async function restoreLocal(name: string): Promise<void> {
  const file = join(paths.backups, basename(name))
  if (!existsSync(file)) throw new AppError('That backup no longer exists.')
  await restoreFromPath(file)
}

export async function restoreFromDrive(fileId: string): Promise<void> {
  const tmp = join(tmpdir(), `lifestyle-download-${Date.now()}.db`)
  try {
    await drive.download(fileId, tmp)
    await restoreFromPath(tmp)
  } finally {
    rmSync(tmp, { force: true })
  }
}

export const connectDrive = drive.connect
export const disconnectDrive = drive.disconnect
export const listDriveBackups = (): Promise<DriveBackup[]> => drive.listBackups()

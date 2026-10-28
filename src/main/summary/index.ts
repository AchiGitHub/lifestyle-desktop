import type { OwnerSummaryStatus } from '../../shared/api'
import { nowLocalIso, parseIsoDate, todayIso, toIsoDate } from '../../shared/dates'
import { ownerEmailInput } from '../../shared/schemas'
import { driveConfigured, friendly, summarySheetStore } from '../backup/drive'
import { readConfig, updateConfig } from '../config'
import { AppError } from '../services/errors'
import { receiptSettings } from '../services/receipts'
import { putSetting, readSettings } from '../services/settings'
import { daySummaries } from '../services/summary'
import { conn } from '../state'
import { summaryRows, titleRows, toCsv } from './sheet'
import { syncSheet } from './sync'

// With the data, so a restored backup still knows who the owner is.
const OWNER_EMAIL = 'summary.ownerEmail'
const MONTHS_SHOWN = 3
let running = false

const ownerEmail = (): string => readSettings(conn().db, [OWNER_EMAIL]).get(OWNER_EMAIL) ?? ''
const driveConnected = (): boolean => driveConfigured() && Boolean(readConfig().drive)
const enabled = (): boolean => readConfig().ownerSummary?.enabled !== false

/** True when the sheet should be kept up to date. */
export const summaryDue = (): boolean => driveConnected() && enabled()

export function summaryStatus(): OwnerSummaryStatus {
  const saved = readConfig().ownerSummary
  return {
    driveConnected: driveConnected(),
    enabled: enabled(),
    ownerEmail: ownerEmail(),
    url: saved?.url ?? null,
    lastUpdatedAt: saved?.lastUpdatedAt ?? null,
    lastError: saved?.lastError ?? null,
    running
  }
}

/** This month so far and the two before it. */
function sheetRange(today: string): { from: string; to: string } {
  const first = parseIsoDate(today)
  first.setDate(1)
  first.setMonth(first.getMonth() - (MONTHS_SHOWN - 1))
  return { from: toIsoDate(first), to: today }
}

export async function updateSummary(): Promise<void> {
  if (!driveConnected()) throw new AppError('Connect Google Drive first.')
  if (running) throw new AppError('The summary is already being updated.')
  running = true
  try {
    const db = conn().db
    const today = todayIso()
    const gymName = receiptSettings(db).gymName
    const csv = toCsv([...titleRows(gymName, nowLocalIso()), ...summaryRows(daySummaries(db, sheetRange(today)), today)])
    const next = await syncSheet(summarySheetStore(), readConfig().ownerSummary ?? {}, csv, ownerEmail())
    updateConfig((c) => {
      c.ownerSummary = { ...c.ownerSummary, ...next, lastUpdatedAt: new Date().toISOString(), lastError: null }
    })
  } catch (e) {
    const error = friendly(e)
    updateConfig((c) => {
      c.ownerSummary = { ...c.ownerSummary, lastError: error.message }
    })
    throw error
  } finally {
    running = false
  }
}

/** For the hourly timer and closing the app: failures only show in Settings. */
export async function quietSummaryUpdate(): Promise<void> {
  if (!summaryDue() || running) return
  try {
    await updateSummary()
  } catch (e) {
    console.warn('Daily summary update failed:', (e as Error).message)
  }
}

export function setSummaryEnabled(on: boolean): void {
  updateConfig((c) => {
    c.ownerSummary = { ...c.ownerSummary, enabled: on }
  })
  if (on) void quietSummaryUpdate()
}

/** Saves the owner's Google account and, if Drive is connected, shares the sheet with it now. */
export async function setOwnerEmail(raw: string): Promise<void> {
  const email = ownerEmailInput.parse(raw) as string
  putSetting(conn().db, OWNER_EMAIL, email || null)
  if (email && summaryDue() && !running) await updateSummary()
}

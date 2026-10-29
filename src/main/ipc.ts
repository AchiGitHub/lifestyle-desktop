import { ipcMain } from 'electron'
import { count } from 'drizzle-orm'
import { ZodError } from 'zod'
import type { Api, IpcResult } from '../shared/api'
import { daySummaryText, receiptText } from '../shared/receipts'
import { whatsappNumber } from '../shared/reminders'
import * as backup from './backup'
import { snapshot } from './backup/local'
import { door } from './door'
import { members, registrations } from './db/schema'
import type { LanService } from './lan/service'
import { printHtml } from './print'
import { receiptHtml } from './print/html'
import { saveAccounts, showSaved } from './reports'
import * as auth from './services/auth'
import { recordCreditReminder } from './services/credit'
import { AppError } from './services/errors'
import * as receipts from './services/receipts'
import * as reminders from './services/reminders'
import * as summary from './services/summary'
import * as ownerSummary from './summary'
import { paths } from './paths'
import { staffDevices } from './staff'
import { conn, domain, isAuthenticated, setAuthenticated } from './state'
import * as updater from './updater'
import { hasWhatsAppDesktop, openChat } from './whatsapp'

const lanApi = (lan: LanService): Api['doorTablet'] & Api['staffDevices'] => ({
  status: async () => lan.status(),
  setEnabled: (on) => lan.setEnabled(on),
  setPort: (port) => lan.setPort(port),
  startPairing: async (name?: string) => lan.startPairing(name),
  removeDevice: async (id) => lan.removeDevice(id)
})

function api(): Api {
  const db = conn().db
  const services = domain()
  return {
    ...services,
    reports: { ...services.reports, accounts: saveAccounts, showSaved },
    auth: {
      status: async () => ({
        hasPassword: auth.hasPassword(db),
        authenticated: isAuthenticated(),
        isEmpty:
          db.select({ n: count() }).from(members).get()!.n === 0 &&
          db.select({ n: count() }).from(registrations).get()!.n === 0
      }),
      login: async (password) => {
        const ok = auth.verifyPassword(db, password)
        setAuthenticated(ok)
        return ok
      },
      setPassword: async (password) => {
        // Only on first run (or after restoring data that has no password).
        if (auth.hasPassword(db)) throw new AppError('A password is already set. Use Change password in Settings.')
        auth.setPassword(db, password)
        setAuthenticated(true)
      },
      changePassword: async (current, next) => {
        if (!auth.verifyPassword(db, current)) throw new AppError('The current password is wrong.')
        auth.setPassword(db, next)
      },
      logout: async () => setAuthenticated(false)
    },
    backup: {
      status: async () => backup.backupStatus(),
      backupNow: backup.backupNow,
      connectDrive: backup.connectDrive,
      disconnectDrive: backup.disconnectDrive,
      listDriveBackups: backup.listDriveBackups,
      restoreFromDrive: backup.restoreFromDrive,
      restoreFromFile: backup.restoreFromFile,
      restoreLocal: backup.restoreLocal
    },
    reminders: {
      settings: async () => ({ ...reminders.reminderSettings(db), whatsappDesktop: hasWhatsAppDesktop() }),
      save: async (input) => reminders.saveReminderSettings(db, input),
      send: async (input) => {
        const reminder = reminders.prepareReminder(db, input)
        await openChat(reminder.phone, reminder.text)
        reminders.recordReminder(db, reminder)
      },
      sendCredit: async (memberId) => {
        const reminder = reminders.prepareCreditReminder(db, memberId)
        await openChat(reminder.phone, reminder.text)
        recordCreditReminder(db, memberId)
      }
    },
    receipts: {
      get: async (paymentId) => receipts.getReceipt(db, paymentId),
      print: (paymentId) => printHtml(receiptHtml(receipts.getReceipt(db, paymentId))),
      sendWhatsApp: async (paymentId, to) => {
        const receipt = receipts.getReceipt(db, paymentId)
        await openChat(receipts.receiptRecipient(receipt, to), receiptText(receipt))
      },
      printSample: () => printHtml(receiptHtml(receipts.sampleReceipt(db))),
      settings: async () => receipts.receiptSettings(db),
      saveSettings: async (input) => receipts.saveReceiptSettings(db, input)
    },
    doorTablet: lanApi(door),
    staffDevices: lanApi(staffDevices),
    updates: {
      status: async () => updater.updateStatus(),
      check: updater.checkForUpdate,
      install: () => updater.installUpdate(() => snapshot(conn().sqlite, paths.backups, 'before-update'))
    },
    summary: {
      days: async (range) => summary.daySummaries(db, range),
      sendToOwner: async (date) => {
        const settings = receipts.receiptSettings(db)
        const phone = whatsappNumber(settings.ownerPhone)
        if (!phone) throw new AppError("Add the owner's WhatsApp number in Settings → Receipts first.")
        await openChat(phone, daySummaryText(summary.daySummary(db, date), settings.gymName))
      },
      status: async () => ownerSummary.summaryStatus(),
      setEnabled: async (on) => ownerSummary.setSummaryEnabled(on),
      setOwnerEmail: ownerSummary.setOwnerEmail,
      updateNow: ownerSummary.updateSummary
    }
  }
}

const PUBLIC = new Set(['auth.status', 'auth.login', 'auth.setPassword'])
// Before any password exists, the first-run screen may restore a backup.
const FIRST_RUN = new Set([
  'backup.status',
  'backup.connectDrive',
  'backup.listDriveBackups',
  'backup.restoreFromDrive',
  'backup.restoreFromFile'
])

function toMessage(e: unknown): string {
  if (e instanceof AppError) return e.message
  if (e instanceof ZodError) return e.issues[0]?.message ?? 'Some details are missing or invalid.'
  const err = e as { code?: string; message?: string }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'This record is still used elsewhere, so it can’t be changed that way.'
  console.error(e)
  return `Something went wrong: ${err.message ?? String(e)}`
}

export function registerIpc(): void {
  ipcMain.handle('api', async (_event, method: string, args: unknown[]): Promise<IpcResult<unknown>> => {
    try {
      if (!PUBLIC.has(method) && !isAuthenticated()) {
        const firstRun = FIRST_RUN.has(method) && !auth.hasPassword(conn().db)
        if (!firstRun) throw new AppError('Please sign in again.')
      }
      const [group, name] = method.split('.')
      const fn = (api() as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[group]?.[
        name
      ]
      if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`)
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return { ok: false, error: toMessage(e) }
    }
  })
}

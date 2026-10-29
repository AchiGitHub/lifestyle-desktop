import { app, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DateRangeInput } from '../../shared/schemas'
import { accountsFileName, accountsReport } from '../services/accounts'
import { AppError } from '../services/errors'
import { conn } from '../state'
import { accountsWorkbook } from './workbook'

/** Only the file saved last can be shown in File Explorer: the window can't name any other path. */
let lastSaved: string | null = null

/** Asks where to save the accountant's workbook for a period, then writes it. Null if staff cancel. */
export async function saveAccounts(range: DateRangeInput): Promise<string | null> {
  const report = accountsReport(conn().db, range)
  const picked = await dialog.showSaveDialog({
    title: 'Save the accounts report',
    defaultPath: join(app.getPath('documents'), accountsFileName(report.gym.gymName, report.from, report.to)),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
  })
  if (picked.canceled || !picked.filePath) return null
  const workbook = await accountsWorkbook(report, app.getVersion())
  try {
    await writeFile(picked.filePath, workbook)
  } catch (e) {
    if ((e as { code?: string }).code === 'EBUSY' || (e as { code?: string }).code === 'EPERM') {
      throw new AppError('That file is open in Excel. Close it there, or save under another name.')
    }
    throw e
  }
  lastSaved = picked.filePath
  return picked.filePath
}

export async function showSaved(): Promise<void> {
  if (lastSaved) shell.showItemInFolder(lastSaved)
}

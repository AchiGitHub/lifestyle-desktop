import { BrowserWindow } from 'electron'
import { AppError } from '../services/errors'

/**
 * Prints a self-contained HTML page through the Windows print dialog, where
 * staff pick the printer (or "Microsoft Print to PDF"). Cancelling is fine.
 */
export async function printHtml(html: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: false }, (success, reason) => {
        if (success || /cancel/i.test(reason)) resolve()
        else reject(new AppError(`Printing failed: ${reason}`))
      })
    })
  } finally {
    win.destroy()
  }
}

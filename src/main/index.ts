import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { backupDue, backupNow } from './backup'
import { dailySnapshot, snapshot } from './backup/local'
import { setDeskWindow, startDoorServer, stopDoorServer } from './door'
import { registerIpc } from './ipc'
import { paths } from './paths'
import { conn, openDb } from './state'
import { quietSummaryUpdate, summaryDue } from './summary'
import { installingUpdate, startUpdater, updateReady } from './updater'

const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000
const QUIT_BACKUP_TIMEOUT_MS = 30_000

// Development only: run against a throwaway data folder (tests, screenshots).
if (!app.isPackaged && process.env.LIFESTYLE_USER_DATA) {
  app.setPath('userData', process.env.LIFESTYLE_USER_DATA)
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    // Small enough for a 1366×768 screen at 125% scaling (~1090×570 usable).
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Lifestyle',
    backgroundColor: '#f8f9fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })
  // Links open in the browser; the app window never navigates away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** A local copy once a day, including when the app is left open for days. */
function dailyLocalCopy(): void {
  void Promise.resolve()
    .then(() => dailySnapshot(conn().sqlite, paths.backups))
    .catch((e) => console.warn('Local snapshot failed:', e))
}

async function quietBackup(): Promise<void> {
  if (!backupDue()) return
  try {
    await backupNow()
  } catch (e) {
    // Recorded in the backup status; the app shows a banner if it keeps failing.
    console.warn('Automatic backup failed:', (e as Error).message)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null)
    openDb()
    registerIpc()
    createWindow()
    setDeskWindow(mainWindow)
    startDoorServer().catch((e) => console.warn('Door check-in server failed to start:', e))
    dailyLocalCopy()
    setTimeout(() => void quietBackup(), 60_000)
    setTimeout(() => void quietSummaryUpdate(), 90_000)
    setInterval(() => {
      dailyLocalCopy()
      void quietBackup()
      void quietSummaryUpdate()
    }, AUTO_BACKUP_CHECK_MS)
    startUpdater()
  })

  // On the way out: a Drive backup if the last good one is over a day old, the
  // owner's summary with the day's last payments, and a local copy if a
  // downloaded update is about to install.
  let quitting = false
  app.on('before-quit', (event) => {
    // "Restart and update" already saved a copy, and the installer is waiting for the app to close.
    if (quitting || installingUpdate()) return
    const work: Promise<unknown>[] = []
    if (backupDue()) work.push(quietBackup())
    if (summaryDue()) work.push(quietSummaryUpdate())
    if (updateReady()) {
      work.push(snapshot(conn().sqlite, paths.backups, 'before-update').catch((e) => console.warn('Copy before update failed:', e)))
    }
    if (work.length === 0) return
    event.preventDefault()
    quitting = true
    const timeout = new Promise((resolve) => setTimeout(resolve, QUIT_BACKUP_TIMEOUT_MS))
    void Promise.race([Promise.all(work), timeout]).finally(() => app.quit())
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => void stopDoorServer())
}

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '../shared/api'
import { AppError } from './services/errors'

const FIRST_CHECK_MS = 2 * 60 * 1000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus = {
  enabled: false,
  currentVersion: app.getVersion(),
  state: 'idle',
  version: null,
  percent: null,
  error: null,
  lastCheckedAt: null
}
let installing = false

const set = (patch: Partial<UpdateStatus>): void => {
  status = { ...status, ...patch }
}

function describe(e: Error & { code?: string }): { nothingPublished: boolean; message: string } {
  const text = e.message ?? String(e)
  // No release published yet: not a problem.
  if (
    e.code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' ||
    e.code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
    /No published versions|Unable to find latest version/i.test(text)
  ) {
    return { nothingPublished: true, message: '' }
  }
  // A release exists but its files didn't all upload.
  if (e.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || /Cannot find .*latest\.yml/i.test(text)) {
    return {
      nothingPublished: false,
      message: 'The newest release on GitHub is missing its latest.yml file, so it can’t be installed yet.'
    }
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ECONNREFUSED|ERR_INTERNET|net::/i.test(text)) {
    return { nothingPublished: false, message: 'No internet connection.' }
  }
  return { nothingPublished: false, message: text.split('\n')[0] }
}

/**
 * Looks for a newer version on GitHub Releases a couple of minutes after the
 * app opens and every few hours after, and downloads it in the background.
 * It installs when the app closes, or straight away from the "Update ready"
 * button. Development builds don't update, unless given a test feed.
 */
export function startUpdater(): void {
  const testFeed = app.isPackaged ? undefined : process.env.LIFESTYLE_UPDATE_FEED
  if (!app.isPackaged && !testFeed) return
  if (testFeed) {
    // Test runs only: a plain web feed, and a download folder apart from the real one.
    const config = join(app.getPath('userData'), 'dev-app-update.yml')
    writeFileSync(config, `provider: generic\nurl: ${testFeed}\nupdaterCacheDirName: lifestyle-desktop-test-updater\n`)
    autoUpdater.updateConfigPath = config
    autoUpdater.forceDevUpdateConfig = true
  }
  set({ enabled: true })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const checked = () => new Date().toISOString()
  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'ready') set({ state: 'checking', error: null })
  })
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date', lastCheckedAt: checked() }))
  autoUpdater.on('update-available', (info) =>
    set({ state: 'downloading', version: info.version, percent: 0, lastCheckedAt: checked() })
  )
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (e) => {
    if (status.state === 'ready') return
    const { nothingPublished, message } = describe(e)
    set(
      nothingPublished
        ? { state: 'up-to-date', error: null, lastCheckedAt: checked() }
        : { state: 'error', error: message, lastCheckedAt: checked() }
    )
  })

  // Problems arrive through the 'error' event as well; nothing to do here.
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(check, FIRST_CHECK_MS)
  setInterval(check, CHECK_EVERY_MS)
}

export const updateStatus = (): UpdateStatus => status
export const updateReady = (): boolean => status.state === 'ready'
export const installingUpdate = (): boolean => installing

export async function checkForUpdate(): Promise<void> {
  if (!status.enabled) throw new AppError('Updates are off in development builds.')
  await autoUpdater.checkForUpdates().catch(() => undefined)
}

/** Saves a safety copy, then closes the app, installs the update quietly and opens it again. */
export async function installUpdate(safetyCopy: () => Promise<unknown>): Promise<void> {
  if (status.state !== 'ready') throw new AppError('No update is ready to install.')
  await safetyCopy()
  installing = true
  autoUpdater.quitAndInstall(true, true)
}

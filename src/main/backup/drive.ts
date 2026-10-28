import { auth, drive, type drive_v3 } from '@googleapis/drive'
import { safeStorage, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DriveBackup } from '../../shared/api'
import { readConfig, updateConfig } from '../config'
import { AppError } from '../services/errors'
import type { SheetRef, SheetStore } from '../summary/sync'

// drive.file only reaches files this app created, and needs no Google review.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SCOPES = [DRIVE_SCOPE, 'openid', 'email']
const NO_DRIVE_ACCESS =
  "Lifestyle wasn't allowed to use Google Drive. Connect again, and on Google's page tick the Google Drive box before pressing Continue."
const FOLDER_NAME = 'Lifestyle Backups'
const KEEP = 30
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET

type OAuth2 = InstanceType<typeof auth.OAuth2>
type AuthUrlOptions = NonNullable<Parameters<OAuth2['generateAuthUrl']>[0]>

export const driveConfigured = (): boolean => Boolean(clientId && clientSecret)

export function friendly(e: unknown): Error {
  if (e instanceof AppError) return e
  const text = String((e as { message?: string })?.message ?? e)
  if (/invalid_grant|unauthorized_client|invalid_client/i.test(text)) {
    return new AppError('The Google Drive sign-in has expired. Reconnect Google Drive in Settings.')
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ECONNREFUSED|network/i.test(text)) {
    return new AppError("Couldn't reach Google Drive. Check the internet connection and try again.")
  }
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
    return new AppError(
      "Lifestyle isn't allowed to use Google Drive. In Settings, disconnect Google Drive and connect again, ticking the Google Drive box on Google's page."
    )
  }
  return new AppError(`Google Drive error: ${text}`)
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Lifestyle</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#153462">
<p style="font-size:18px">${message}</p></body>`
}

function emailFromIdToken(idToken: string | null | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

/** Google's loopback sign-in for desktop apps: system browser + local redirect + PKCE. */
export async function connect(): Promise<void> {
  if (!driveConfigured()) throw new AppError("Google Drive isn't set up in this build of the app.")
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const client = new auth.OAuth2(clientId, clientSecret, redirectUri)
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const state = randomBytes(16).toString('hex')
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256' as unknown as AuthUrlOptions['code_challenge_method']
  })

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AppError('Google sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS)
      server.on('request', (req, res) => {
        const params = new URL(req.url ?? '/', redirectUri).searchParams
        if (params.get('state') !== state) {
          res.writeHead(404).end()
          return
        }
        const code = params.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          page(
            code
              ? 'Google Drive is connected. You can close this tab and go back to Lifestyle.'
              : 'Google sign-in was cancelled. You can close this tab.'
          )
        )
        clearTimeout(timer)
        if (code) resolve(code)
        else reject(new AppError('Google sign-in was cancelled.'))
      })
      shell.openExternal(url).catch(reject)
    })
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri })
    // Google's consent page lists Drive access as a checkbox, which can be left unticked.
    if (tokens.scope && !tokens.scope.split(' ').includes(DRIVE_SCOPE)) {
      throw new AppError(NO_DRIVE_ACCESS)
    }
    if (!tokens.refresh_token) {
      throw new AppError("Google didn't grant lasting access. Try connecting again.")
    }
    const refreshToken = safeStorage.encryptString(tokens.refresh_token).toString('base64')
    updateConfig((c) => {
      c.drive = { refreshToken, account: emailFromIdToken(tokens.id_token) }
    })
  } catch (e) {
    throw friendly(e)
  } finally {
    server.close()
  }
}

function signedInClient(): OAuth2 {
  const saved = readConfig().drive
  if (!saved) throw new AppError('Connect Google Drive in Settings first.')
  const client = new auth.OAuth2(clientId, clientSecret)
  client.setCredentials({ refresh_token: safeStorage.decryptString(Buffer.from(saved.refreshToken, 'base64')) })
  return client
}

export async function disconnect(): Promise<void> {
  try {
    const client = signedInClient()
    const token = client.credentials.refresh_token
    if (token) await client.revokeToken(token)
  } catch {
    // Forgetting the sign-in locally is what matters; revoking is best effort.
  }
  updateConfig((c) => {
    delete c.drive
  })
}

async function backupFolder(d: drive_v3.Drive): Promise<string> {
  const cached = readConfig().drive?.folderId
  if (cached) {
    try {
      const folder = await d.files.get({ fileId: cached, fields: 'id,trashed' })
      if (!folder.data.trashed) return cached
    } catch {
      // Deleted or no longer visible: find or create it again below.
    }
  }
  const found = await d.files.list({
    q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    spaces: 'drive'
  })
  let id = found.data.files?.[0]?.id
  if (!id) {
    const created = await d.files.create({
      requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    })
    id = created.data.id!
  }
  updateConfig((c) => {
    if (c.drive) c.drive.folderId = id
  })
  return id
}

async function listIn(d: drive_v3.Drive, folderId: string): Promise<DriveBackup[]> {
  const res = await d.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,createdTime,size)',
    pageSize: 200
  })
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name ?? '',
    createdTime: f.createdTime ?? '',
    size: Number(f.size ?? 0)
  }))
}

export async function listBackups(): Promise<DriveBackup[]> {
  try {
    const d = drive({ version: 'v3', auth: signedInClient() })
    return await listIn(d, await backupFolder(d))
  } catch (e) {
    throw friendly(e)
  }
}

/** Uploads a database snapshot, then trims the folder to the newest backups. */
export async function upload(file: string, name: string): Promise<void> {
  try {
    const d = drive({ version: 'v3', auth: signedInClient() })
    const folderId = await backupFolder(d)
    await d.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType: 'application/x-sqlite3', body: createReadStream(file) },
      fields: 'id'
    })
    const all = await listIn(d, folderId)
    for (const old of all.slice(KEEP)) await d.files.delete({ fileId: old.id })
  } catch (e) {
    throw friendly(e)
  }
}

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const SUMMARY_NAME = 'Lifestyle daily summary'
// Tags the sheet so it can be found again, e.g. after moving to a new PC, even if renamed.
const SUMMARY_TAG = { lifestyle: 'daily-summary' }

const httpStatus = (e: unknown): number | undefined => {
  const err = e as { status?: number; code?: number | string; response?: { status?: number } }
  return err.response?.status ?? err.status ?? (typeof err.code === 'number' ? err.code : undefined)
}

/** The owner's summary sheet in Drive. CSV uploads become a Google Sheet. */
export function summarySheetStore(): SheetStore {
  const d = drive({ version: 'v3', auth: signedInClient() })
  const toRef = (f: drive_v3.Schema$File): SheetRef => ({
    id: f.id!,
    url: f.webViewLink ?? `https://docs.google.com/spreadsheets/d/${f.id}/edit`
  })
  const csvMedia = (csv: string) => ({ mimeType: 'text/csv', body: Readable.from([csv]) })
  return {
    find: async () => {
      const res = await d.files.list({
        q: `appProperties has { key='lifestyle' and value='daily-summary' } and trashed = false`,
        fields: 'files(id,webViewLink)',
        spaces: 'drive'
      })
      const f = res.data.files?.[0]
      return f ? toRef(f) : null
    },
    create: async (csv) => {
      const res = await d.files.create({
        requestBody: { name: SUMMARY_NAME, mimeType: SHEET_MIME, appProperties: SUMMARY_TAG },
        media: csvMedia(csv),
        fields: 'id,webViewLink'
      })
      return toRef(res.data)
    },
    update: async (id, csv) => {
      try {
        const meta = await d.files.get({ fileId: id, fields: 'trashed' })
        if (meta.data.trashed) return null
        const res = await d.files.update({ fileId: id, media: csvMedia(csv), fields: 'id,webViewLink' })
        return toRef(res.data)
      } catch (e) {
        if (httpStatus(e) === 404) return null
        throw e
      }
    },
    sharedWith: async (id) => {
      const res = await d.permissions.list({ fileId: id, fields: 'permissions(emailAddress)' })
      return (res.data.permissions ?? []).flatMap((p) => (p.emailAddress ? [p.emailAddress.toLowerCase()] : []))
    },
    share: async (id, email) => {
      await d.permissions.create({
        fileId: id,
        sendNotificationEmail: true,
        emailMessage: 'The gym’s daily takings, sign-ups and check-ins. The Lifestyle app keeps this sheet up to date.',
        requestBody: { type: 'user', role: 'reader', emailAddress: email }
      })
    }
  }
}

export async function download(fileId: string, dest: string): Promise<void> {
  try {
    const d = drive({ version: 'v3', auth: signedInClient() })
    const res = await d.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    await pipeline(res.data as unknown as NodeJS.ReadableStream, createWriteStream(dest))
  } catch (e) {
    throw friendly(e)
  }
}

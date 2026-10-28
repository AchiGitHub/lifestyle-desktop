// The door tablet's web server: the check-in page and a tiny JSON API, on the
// gym's local network. Plain Node (no Electron) so it can be tested directly.
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import type { CheckInCandidate, CheckInResult } from '../../shared/api'
import { AppError } from '../services/errors'

export interface DoorServerOptions {
  /** Built renderer files: door.html and assets/. */
  staticDir: string
  /** Device id for a valid token, or null. */
  authenticate(token: string): string | null
  /** A new device token for a correct pairing code, or null. */
  pair(code: string): string | null
  gymName(): string
  find(mobile: string): CheckInCandidate[]
  checkIn(memberId: string): CheckInResult
  now?: () => number
}

const MAX_BODY = 1024
/** Requests per minute, per device (or, for pairing, for everyone). */
const LIMITS = { find: 20, checkIn: 10, pair: 10 } as const

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  })
  res.end(text)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Too much data.')
    chunks.push(chunk as Buffer)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw new HttpError(400, 'Bad request.')
  }
}

const text = (body: Record<string, unknown>, key: string): string => {
  const v = body[key]
  if (typeof v !== 'string' || v.length > 100) throw new HttpError(400, 'Bad request.')
  return v
}

export function createDoorServer(o: DoorServerOptions): Server {
  const now = o.now ?? Date.now
  const hits = new Map<string, number[]>()
  const allow = (key: string, perMinute: number): boolean => {
    const t = now()
    const recent = (hits.get(key) ?? []).filter((at) => t - at < 60_000)
    if (recent.length >= perMinute) {
      hits.set(key, recent)
      return false
    }
    recent.push(t)
    hits.set(key, recent)
    return true
  }

  const device = (req: IncomingMessage): string => {
    const header = req.headers.authorization ?? ''
    const id = header.startsWith('Bearer ') ? o.authenticate(header.slice(7)) : null
    if (!id) throw new HttpError(401, 'This tablet isn’t paired.')
    return id
  }

  async function serveFile(res: ServerResponse, relative: string): Promise<void> {
    const root = normalize(o.staticDir)
    const file = normalize(join(root, relative))
    if (!file.startsWith(root + sep)) return send(res, 404, { error: 'Not found.' })
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': relative.startsWith('assets') ? 'public, max-age=31536000, immutable' : 'no-cache'
      })
      res.end(body)
    } catch {
      send(res, 404, { error: 'Not found.' })
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://door').pathname)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return serveFile(res, 'door.html')
    if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, path.slice(1))

    if (req.method === 'POST' && path === '/api/pair') {
      if (!allow('pair', LIMITS.pair)) throw new HttpError(429, 'Too many tries. Wait a minute.')
      const token = o.pair(text(await readJson(req), 'code'))
      if (!token) throw new HttpError(403, 'That code is wrong or has expired. Make a new one at the front desk.')
      return send(res, 200, { token })
    }
    if (req.method === 'GET' && path === '/api/ping') {
      device(req)
      return send(res, 200, { gymName: o.gymName() })
    }
    if (req.method === 'POST' && path === '/api/find') {
      const id = device(req)
      if (!allow(`find:${id}`, LIMITS.find)) throw new HttpError(429, 'Too many tries. Wait a minute.')
      return send(res, 200, { people: o.find(text(await readJson(req), 'mobile')) })
    }
    if (req.method === 'POST' && path === '/api/check-in') {
      const id = device(req)
      if (!allow(`checkIn:${id}`, LIMITS.checkIn)) throw new HttpError(429, 'Too many tries. Wait a minute.')
      const r = o.checkIn(text(await readJson(req), 'memberId'))
      // Only what the door shows: no surname, phone or money.
      return send(res, 200, { firstName: r.firstName, status: r.status, endDate: r.endDate, repeat: r.repeat })
    }
    send(res, 404, { error: 'Not found.' })
  }

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return res.destroy()
      if (e instanceof HttpError) return send(res, e.status, { error: e.message })
      if (e instanceof AppError) return send(res, 400, { error: e.message })
      send(res, 500, { error: 'Something went wrong. Please see the front desk.' })
    })
  })
}

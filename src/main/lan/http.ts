// The small web servers the desk app runs on the gym's local network (the door
// tablet, instructors' phones): one built page, a JSON API, and pairing.
// Plain Node (no Electron) so they can be tested directly.
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { ZodError } from 'zod'
import { AppError } from '../services/errors'

const MAX_BODY = 1024
/** Pairing attempts per minute, for everyone together. */
const PAIR_LIMIT = 10

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

export class HttpError extends Error {
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

/** A short string from a request body. */
export const text = (body: Record<string, unknown>, key: string): string => {
  const v = body[key]
  if (typeof v !== 'string' || v.length > 100) throw new HttpError(400, 'Bad request.')
  return v
}

/** What a route can ask about the request it's answering. */
export interface LanRequest {
  /** The paired device asking; a request without a valid token gets a 401. */
  device(): string
  /** Allows `perMinute` requests under `key`, then answers 429. */
  limit(key: string, perMinute: number): void
  json(): Promise<Record<string, unknown>>
}

/** Handlers by "METHOD /path"; what they return is sent back as JSON. */
export type LanRoutes = Record<string, (r: LanRequest) => unknown>

export interface LanServerOptions {
  /** Built renderer files: the page and assets/. */
  staticDir: string
  /** The page served at /, e.g. door.html. */
  page: string
  /** Device id for a valid token, or null. */
  authenticate(token: string): string | null
  /** A new device token for a correct pairing code, or null. */
  pair(code: string): string | null
  routes: LanRoutes
  /** Told to a device that isn't (or is no longer) paired. */
  unpairedMessage: string
  /** Told when something unexpected goes wrong. */
  failureMessage: string
  now?: () => number
}

export function createLanServer(o: LanServerOptions): Server {
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
  const limit = (key: string, perMinute: number): void => {
    if (!allow(key, perMinute)) throw new HttpError(429, 'Too many tries. Wait a minute.')
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
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://lan').pathname)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return serveFile(res, o.page)
    if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, path.slice(1))

    if (req.method === 'POST' && path === '/api/pair') {
      limit('pair', PAIR_LIMIT)
      const token = o.pair(text(await readJson(req), 'code'))
      if (!token) throw new HttpError(403, 'That code is wrong or has expired. Make a new one at the front desk.')
      return send(res, 200, { token })
    }

    const route = o.routes[`${req.method} ${path}`]
    if (!route) return send(res, 404, { error: 'Not found.' })
    const body = await route({
      device: () => {
        const header = req.headers.authorization ?? ''
        const id = header.startsWith('Bearer ') ? o.authenticate(header.slice(7)) : null
        if (!id) throw new HttpError(401, o.unpairedMessage)
        return id
      },
      limit,
      json: () => readJson(req)
    })
    send(res, 200, body)
  }

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return res.destroy()
      if (e instanceof HttpError) return send(res, e.status, { error: e.message })
      if (e instanceof AppError) return send(res, 400, { error: e.message })
      if (e instanceof ZodError) return send(res, 400, { error: e.issues[0]?.message ?? 'Bad request.' })
      send(res, 500, { error: o.failureMessage })
    })
  })
}

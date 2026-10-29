// The door tablet's check-in page and its tiny JSON API, on the gym's local
// network. Plain Node (no Electron) so it can be tested directly.
import type { Server } from 'node:http'
import type { CheckInCandidate, CheckInResult } from '../../shared/api'
import { createLanServer, text } from '../lan/http'

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

/** Requests per minute, per tablet. */
const LIMITS = { find: 20, checkIn: 10 } as const

export function createDoorServer(o: DoorServerOptions): Server {
  return createLanServer({
    staticDir: o.staticDir,
    page: 'door.html',
    authenticate: o.authenticate,
    pair: o.pair,
    now: o.now,
    unpairedMessage: 'This tablet isn’t paired.',
    failureMessage: 'Something went wrong. Please see the front desk.',
    routes: {
      'GET /api/ping': (r) => {
        r.device()
        return { gymName: o.gymName() }
      },
      'POST /api/find': async (r) => {
        r.limit(`find:${r.device()}`, LIMITS.find)
        return { people: o.find(text(await r.json(), 'mobile')) }
      },
      'POST /api/check-in': async (r) => {
        r.limit(`checkIn:${r.device()}`, LIMITS.checkIn)
        const result = o.checkIn(text(await r.json(), 'memberId'))
        // Only what the door shows: no surname, phone or money.
        return { firstName: result.firstName, status: result.status, endDate: result.endDate, repeat: result.repeat }
      }
    }
  })
}

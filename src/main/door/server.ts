// The door tablet's check-in page and its tiny JSON API, on the gym's local
// network. Plain Node (no Electron) so it can be tested directly.
import type { Server } from 'node:http'
import type { CheckInCandidate, CheckInOption, CheckInResult } from '../../shared/api'
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
  /** Personal training they could check in for, if any. */
  options(memberId: string): CheckInOption[]
  /** With a package, a personal training session. */
  checkIn(memberId: string, ptRegistrationId: string | null): CheckInResult
  now?: () => number
}

/** Requests per minute, per tablet. A check-in with a choice takes two. */
const LIMITS = { find: 20, checkIn: 20 } as const

/** "Kasun Perera" → "Kasun": the door shows first names only. */
const firstName = (name: string): string => name.trim().split(/\s+/)[0]

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
      // Someone with personal training first chooses what they're here for:
      // without `purpose`, they get the choice and nothing is recorded yet.
      'POST /api/check-in': async (r) => {
        r.limit(`checkIn:${r.device()}`, LIMITS.checkIn)
        const body = await r.json()
        const memberId = text(body, 'memberId')
        const purpose = body.purpose === undefined ? null : text(body, 'purpose')
        if (purpose === null) {
          const options = o.options(memberId)
          if (options.length > 0) {
            return {
              choose: options.map((p) => ({ id: p.ptRegistrationId, trainer: firstName(p.trainerName), sessionsLeft: p.sessionsLeft }))
            }
          }
        }
        const result = o.checkIn(memberId, purpose === null || purpose === 'GYM' ? null : purpose)
        // Only what the door shows: no surname, phone or money.
        return {
          firstName: result.firstName,
          status: result.status,
          endDate: result.endDate,
          repeat: result.repeat,
          session: result.session && { trainer: firstName(result.session.trainerName), sessionsLeft: result.session.sessionsLeft }
        }
      }
    }
  })
}

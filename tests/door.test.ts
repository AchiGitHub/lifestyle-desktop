import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments } from '../src/main/db/schema'
import { createDoorServer } from '../src/main/door/server'
import { createPairing, type PairedDevice, type Pairing } from '../src/main/lan/pairing'
import { checkIn, findForCheckIn } from '../src/main/services/visits'
import { addDays, todayIso } from '../src/shared/dates'
import { makeDb, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
let server: Server
let base: string
let pairing: Pairing
let devices: PairedDevice[]
let clock: number
let dir: string

beforeEach(async () => {
  db = makeDb()
  devices = []
  clock = Date.now()
  pairing = createPairing({ devices: () => devices, save: (d) => (devices = d) }, () => clock)

  // A built door page, plus a file just outside the folder that must never be served.
  dir = mkdtempSync(join(tmpdir(), 'door-'))
  mkdirSync(join(dir, 'renderer', 'assets'), { recursive: true })
  writeFileSync(join(dir, 'renderer', 'door.html'), '<html>door</html>')
  writeFileSync(join(dir, 'renderer', 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dir, 'secret.txt'), 'secret')

  server = createDoorServer({
    staticDir: join(dir, 'renderer'),
    authenticate: (t) => pairing.authenticate(t),
    pair: (c) => pairing.pair(c),
    gymName: () => 'LSFS',
    find: (mobile) => findForCheckIn(db, mobile),
    checkIn: (id) => checkIn(db, id, 'DOOR'),
    now: () => clock
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
  rmSync(dir, { recursive: true, force: true })
})

const post = (path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

async function pairedToken(): Promise<string> {
  const { code } = pairing.start()
  const res = await post('/api/pair', { code })
  return ((await res.json()) as { token: string }).token
}

describe('door server', () => {
  it('serves the page and its assets, and nothing outside them', async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe('<html>door</html>')
    expect((await fetch(`${base}/assets/app.js`)).headers.get('content-type')).toMatch(/javascript/)
    for (const path of ['/assets/../../secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/assets/..%5c..%5csecret.txt', '/secret.txt']) {
      expect((await fetch(base + path)).status).toBe(404)
    }
  })

  it('only answers paired tablets', async () => {
    expect((await fetch(`${base}/api/ping`)).status).toBe(401)
    expect((await post('/api/find', { mobile: '0771234567' }, 'made-up')).status).toBe(401)
    const token = await pairedToken()
    expect(await (await fetch(`${base}/api/ping`, { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({ gymName: 'LSFS' })
    // Removed at the desk: locked out.
    devices = []
    expect((await post('/api/find', { mobile: '0771234567' }, token)).status).toBe(401)
  })

  it('pairs with a fresh code once, and gives up after wrong guesses or 10 minutes', async () => {
    let { code } = pairing.start()
    expect((await post('/api/pair', { code })).status).toBe(200)
    expect((await post('/api/pair', { code })).status).toBe(403)

    code = pairing.start().code
    for (let i = 0; i < 5; i++) await post('/api/pair', { code: code === '000000' ? '111111' : '000000' })
    expect((await post('/api/pair', { code })).status).toBe(403)

    code = pairing.start().code
    clock += 11 * 60_000
    expect((await post('/api/pair', { code })).status).toBe(403)
  })

  it('finds and checks in, sharing only what the door shows', async () => {
    const plan = seedPlan(db)
    const id = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567' })
    const reg = seedRegistration(db, plan, [id], addDays(todayIso(), -40), addDays(todayIso(), -5))
    db.insert(payments).values({ id: randomUUID(), registrationId: reg, amount: 10000, paymentType: 'CASH', category: 'MEMBERSHIP' }).run()
    const token = await pairedToken()

    const found = await (await post('/api/find', { mobile: '077 123 4567' }, token)).json()
    expect(found).toEqual({ people: [{ id, name: 'Nimal P.' }] })
    const result = await (await post('/api/check-in', { memberId: id }, token)).json()
    expect(result).toEqual({ firstName: 'Nimal', status: 'EXPIRED', endDate: addDays(todayIso(), -5), repeat: false })
  })

  it('limits lookups per tablet, and refuses oversized or broken requests', async () => {
    const token = await pairedToken()
    for (let i = 0; i < 20; i++) expect((await post('/api/find', { mobile: '0771234567' }, token)).status).toBe(200)
    expect((await post('/api/find', { mobile: '0771234567' }, token)).status).toBe(429)
    clock += 61_000
    expect((await post('/api/find', { mobile: '0771234567' }, token)).status).toBe(200)

    expect((await post('/api/find', { mobile: 'x'.repeat(2000) }, token)).status).toBe(413)
    expect((await post('/api/find', '{not json', token)).status).toBe(400)
    expect((await post('/api/check-in', { memberId: 'nobody' }, token)).status).toBe(400)
  })
})

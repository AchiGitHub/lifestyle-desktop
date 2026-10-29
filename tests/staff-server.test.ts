import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { products } from '../src/main/db/schema'
import { createPairing, type PairedDevice, type Pairing } from '../src/main/lan/pairing'
import { owedList } from '../src/main/services/credit'
import { listPayments } from '../src/main/services/payments'
import { listStockChanges } from '../src/main/services/products'
import { createStaffServer } from '../src/main/staff/server'
import type { StaffSale, StoreChange } from '../src/shared/api'
import { todayIso } from '../src/shared/dates'
import { checkIn } from '../src/main/services/visits'
import { makeDb, seedMember, seedProduct } from './helpers'

let db: Db
let server: Server
let base: string
let pairing: Pairing
let devices: PairedDevice[]
let changes: StoreChange[]
let clock: number
let dir: string
let product: string

beforeEach(async () => {
  db = makeDb()
  devices = []
  changes = []
  clock = Date.now()
  pairing = createPairing({ devices: () => devices, save: (d) => (devices = d) }, () => clock)
  product = seedProduct(db, { quantity: 100 })

  // A built staff page, plus a file just outside the folder that must never be served.
  dir = mkdtempSync(join(tmpdir(), 'staff-'))
  mkdirSync(join(dir, 'renderer', 'assets'), { recursive: true })
  writeFileSync(join(dir, 'renderer', 'staff.html'), '<html>staff</html>')
  writeFileSync(join(dir, 'renderer', 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dir, 'secret.txt'), 'secret')

  server = createStaffServer({
    staticDir: join(dir, 'renderer'),
    authenticate: (t) => pairing.authenticate(t),
    pair: (c) => pairing.pair(c),
    deviceName: (id) => devices.find((d) => d.id === id)?.name ?? null,
    gymName: () => 'LSFS',
    db: () => db,
    onChange: (c) => changes.push(c),
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

const auth = (token?: string) => (token ? { Authorization: `Bearer ${token}` } : {})
const get = (path: string, token?: string) => fetch(base + path, { headers: auth(token) })
const post = (path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body)
  })

const json = async <T>(res: Promise<Response>): Promise<T> => (await (await res).json()) as T

async function phone(name: string): Promise<string> {
  const { code } = pairing.start(name)
  return ((await (await post('/api/pair', { code })).json()) as { token: string }).token
}

const stockNow = () => db.select().from(products).where(eq(products.id, product)).get()!.quantity

describe('instructor phone server', () => {
  it('serves the page and its assets, and nothing outside them', async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe('<html>staff</html>')
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200)
    expect((await fetch(`${base}/assets/%2e%2e/%2e%2e/secret.txt`)).status).toBe(404)
  })

  it('only answers phones paired with it, by the instructor’s name', async () => {
    expect((await get('/api/products')).status).toBe(401)

    // A door tablet's token belongs to the other server's list.
    const doorDevices: PairedDevice[] = []
    const door = createPairing({ devices: () => doorDevices, save: () => undefined })
    const doorToken = door.pair(door.start().code)!
    expect((await get('/api/products', doorToken)).status).toBe(401)

    const token = await phone('Kasun')
    expect(await (await get('/api/ping', token)).json()).toEqual({ gymName: 'LSFS', deviceName: 'Kasun' })
    devices = []
    expect((await post('/api/sell', { productId: product, quantity: 1, paymentType: 'CASH' }, token)).status).toBe(401)
  })

  it('shows products without cost prices', async () => {
    const token = await phone('Kasun')
    const { products: list } = await json<{ products: unknown[] }>(get('/api/products', token))
    expect(list).toEqual([{ id: product, name: 'Yeti Isotonic', productType: 'BEVERAGE', sellingPrice: 350, quantity: 100 }])
  })

  it('sells as the instructor, tells the desk, and lists only that phone’s sales', async () => {
    const kasun = await phone('Kasun')
    const nimali = await phone('Nimali')
    const res = await post('/api/sell', { productId: product, quantity: 2, paymentType: 'CARD' }, kasun)
    const { sale } = (await res.json()) as { sale: StaffSale }
    expect(sale).toMatchObject({ productName: 'Yeti Isotonic', quantity: 2, amount: 700, paymentType: 'CARD' })
    await post('/api/sell', { productId: product, quantity: 1, paymentType: 'CASH' }, nimali)

    expect(stockNow()).toBe(97)
    const today = todayIso()
    expect(listPayments(db, { from: today, to: today }).map((p) => p.recordedBy).sort()).toEqual(['Kasun', 'Nimali'])
    expect(changes[0]).toEqual({
      kind: 'SALE',
      by: 'Kasun',
      productName: 'Yeti Isotonic',
      quantity: 2,
      amount: 700,
      paymentType: 'CARD',
      memberName: null
    })
    const { sales } = await json<{ sales: StaffSale[] }>(get('/api/today', kasun))
    expect(sales.map((s) => s.id)).toEqual([sale.id])
  })

  it('finds the buyer by name, phone or today’s check-ins, and records them on the sale', async () => {
    const token = await phone('Kasun')
    const nimal = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567', nic: '199512345678' })
    expect((await get('/api/members/today')).status).toBe(401)
    expect(await json(get('/api/members/today', token))).toEqual({ members: [] })
    checkIn(db, nimal, 'DOOR')
    const today = { members: [{ id: nimal, name: 'Nimal Perera', phoneEnding: '567' }] }
    expect(await json(get('/api/members/today', token))).toEqual(today)
    // Only the name and the last digits: never the whole number or other details.
    const res = await post('/api/members/find', { query: '077 123' }, token)
    expect(await res.clone().json()).toEqual(today)
    expect(await res.text()).not.toMatch(/4567|1995/)

    const { sale } = await json<{ sale: StaffSale }>(
      post('/api/sell', { productId: product, quantity: 1, paymentType: 'CASH', memberId: nimal }, token)
    )
    expect(sale.memberName).toBe('Nimal Perera')
    expect(changes.at(-1)).toMatchObject({ kind: 'SALE', memberName: 'Nimal Perera' })
  })

  it('sells on credit to a member only, and can undo it', async () => {
    const token = await phone('Kasun')
    const nimal = seedMember(db, { firstName: 'Nimal', lastName: 'Perera' })
    const walkIn = await post('/api/sell', { productId: product, quantity: 1, paymentType: 'CREDIT' }, token)
    expect(walkIn.status).toBe(400)
    expect(await walkIn.json()).toEqual({ error: 'Choose who’s buying: only members can pay later.' })

    const { sale } = await json<{ sale: StaffSale }>(
      post('/api/sell', { productId: product, quantity: 2, paymentType: 'CREDIT', memberId: nimal }, token)
    )
    expect(sale).toMatchObject({ paymentType: 'CREDIT', amount: 700, memberName: 'Nimal Perera' })
    expect(changes.at(-1)).toMatchObject({ kind: 'SALE', paymentType: 'CREDIT', memberName: 'Nimal Perera' })
    expect(stockNow()).toBe(98)
    // Not money taken, but on the phone's list for today.
    expect(listPayments(db, { from: todayIso(), to: todayIso() })).toEqual([])
    expect((await json<{ sales: StaffSale[] }>(get('/api/today', token))).sales.map((s) => s.id)).toEqual([sale.id])
    expect(owedList(db).map((c) => c.owed)).toEqual([700])

    expect((await post('/api/undo', { paymentId: sale.id }, token)).status).toBe(200)
    expect(stockNow()).toBe(100)
    expect(owedList(db)).toEqual([])
  })

  it('adds deliveries and counts, recorded under the instructor', async () => {
    const token = await phone('Kasun')
    expect(await (await post('/api/stock/received', { productId: product, quantity: 24 }, token)).json()).toEqual({
      productName: 'Yeti Isotonic',
      change: 24,
      quantityAfter: 124
    })
    expect(await (await post('/api/stock/count', { productId: product, quantity: 120 }, token)).json()).toMatchObject({
      change: -4,
      quantityAfter: 120
    })
    expect(changes.map((c) => c.kind)).toEqual(['RECEIVED', 'COUNT'])
    const today = todayIso()
    expect(listStockChanges(db, { from: today, to: today }).map((c) => c.recordedBy)).toEqual(['Kasun', 'Kasun'])
  })

  it('undoes a phone’s own sale only', async () => {
    const kasun = await phone('Kasun')
    const nimali = await phone('Nimali')
    const { sale } = await json<{ sale: StaffSale }>(post('/api/sell', { productId: product, quantity: 3, paymentType: 'CASH' }, kasun))
    expect((await post('/api/undo', { paymentId: sale.id }, nimali)).status).toBe(400)
    expect(stockNow()).toBe(97)
    expect((await post('/api/undo', { paymentId: sale.id }, kasun)).status).toBe(200)
    expect(stockNow()).toBe(100)
    expect(changes.at(-1)).toMatchObject({ kind: 'UNDO', by: 'Kasun', quantity: 3 })
  })

  it('explains bad requests, and limits how fast a phone can record', async () => {
    const token = await phone('Kasun')
    const zero = await post('/api/sell', { productId: product, quantity: 0, paymentType: 'CASH' }, token)
    expect(zero.status).toBe(400)
    expect(((await zero.json()) as { error: string }).error).toBe('At least 1')
    const tooMany = await post('/api/sell', { productId: product, quantity: 500, paymentType: 'CASH' }, token)
    expect(((await tooMany.json()) as { error: string }).error).toBe('Only 100 Yeti Isotonic left in stock.')

    for (let i = 0; i < 28; i++) await post('/api/sell', { productId: product, quantity: 1, paymentType: 'CASH' }, token)
    expect((await post('/api/sell', { productId: product, quantity: 1, paymentType: 'CASH' }, token)).status).toBe(429)
    clock += 61_000
    expect((await post('/api/sell', { productId: product, quantity: 1, paymentType: 'CASH' }, token)).status).toBe(200)
  })
})

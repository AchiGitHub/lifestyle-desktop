// The page instructors open on their phones to sell store products and update
// stock, and its JSON API. Plain Node (no Electron) so it can be tested directly.
import type { Server } from 'node:http'
import type { StoreChange } from '../../shared/api'
import type { StockChangeKind } from '../../shared/enums'
import type { SellInput, StockInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { createLanServer, text, type LanRequest } from '../lan/http'
import { checkedInToday, memberChoices } from '../services/members'
import {
  countStock,
  deviceSalesToday,
  receiveStock,
  sellProduct,
  staffProducts,
  staffSale,
  undoSale,
  type Recorder
} from '../services/products'

export interface StaffServerOptions {
  /** Built renderer files: staff.html and assets/. */
  staticDir: string
  /** Device id for a valid token, or null. */
  authenticate(token: string): string | null
  /** A new device token for a correct pairing code, or null. */
  pair(code: string): string | null
  /** The name a phone was paired under: who made a sale or stock change. */
  deviceName(id: string): string | null
  gymName(): string
  db(): Db
  /** Tells the front desk what an instructor just did. */
  onChange?(change: StoreChange): void
  now?: () => number
}

/** Sales, stock changes and undos per minute, per phone. */
const LIMIT = 30

export function createStaffServer(o: StaffServerOptions): Server {
  const recorder = (r: LanRequest): Recorder => {
    const deviceId = r.device()
    return { deviceId, name: o.deviceName(deviceId) ?? 'An instructor' }
  }

  async function stock(r: LanRequest, kind: StockChangeKind) {
    const by = recorder(r)
    r.limit(`stock:${by.deviceId}`, LIMIT)
    const input = (await r.json()) as StockInput
    const result = kind === 'RECEIVED' ? receiveStock(o.db(), input, by) : countStock(o.db(), input, by)
    o.onChange?.({ kind, by: by.name, ...result })
    return result
  }

  return createLanServer({
    staticDir: o.staticDir,
    page: 'staff.html',
    authenticate: o.authenticate,
    pair: o.pair,
    now: o.now,
    unpairedMessage: 'This phone isn’t paired.',
    failureMessage: 'Something went wrong. Try again, or tell the front desk.',
    routes: {
      'GET /api/ping': (r) => ({ gymName: o.gymName(), deviceName: o.deviceName(r.device()) }),
      'GET /api/products': (r) => {
        r.device()
        return { products: staffProducts(o.db()) }
      },
      'GET /api/today': (r) => ({ sales: deviceSalesToday(o.db(), r.device()) }),
      // Choosing who bought something: names and the last digits of their phone, nothing more.
      'GET /api/members/today': (r) => {
        r.device()
        return { members: checkedInToday(o.db()) }
      },
      'POST /api/members/find': async (r) => {
        r.limit(`members:${r.device()}`, LIMIT)
        return { members: memberChoices(o.db(), text(await r.json(), 'query')) }
      },
      'POST /api/sell': async (r) => {
        const by = recorder(r)
        r.limit(`sell:${by.deviceId}`, LIMIT)
        const sale = staffSale(o.db(), sellProduct(o.db(), (await r.json()) as SellInput, by))
        const { productName, quantity, amount, paymentType, memberName } = sale
        o.onChange?.({ kind: 'SALE', by: by.name, productName, quantity, amount, paymentType, memberName })
        return { sale }
      },
      'POST /api/stock/received': (r) => stock(r, 'RECEIVED'),
      'POST /api/stock/count': (r) => stock(r, 'COUNT'),
      'POST /api/undo': async (r) => {
        const by = recorder(r)
        r.limit(`undo:${by.deviceId}`, LIMIT)
        const { productName, quantity, amount, paymentType, memberName } = undoSale(
          o.db(),
          text(await r.json(), 'paymentId'),
          by.deviceId
        )
        o.onChange?.({ kind: 'UNDO', by: by.name, productName, quantity, amount, paymentType, memberName })
        return { ok: true }
      }
    }
  })
}

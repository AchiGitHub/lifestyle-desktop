import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { products } from '../src/main/db/schema'
import { checkedInToday, deleteMembers, memberChoices, mergeMembers } from '../src/main/services/members'
import { listPayments, paymentsForMember } from '../src/main/services/payments'
import {
  countStock,
  deviceSalesToday,
  listStockChanges,
  receiveStock,
  sellProduct,
  undoSale,
  updateProduct
} from '../src/main/services/products'
import { getReceipt } from '../src/main/services/receipts'
import { checkIn } from '../src/main/services/visits'
import { makeDb, seedMember, seedProduct } from './helpers'

let db: Db
let product: string
const kasun = { deviceId: 'phone-1', name: 'Kasun' }
const nimali = { deviceId: 'phone-2', name: 'Nimali' }
const today = '2026-10-29'
const at = (hour: number, minute: number) => vi.setSystemTime(new Date(2026, 9, 29, hour, minute))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(10, 0)
  db = makeDb()
  product = seedProduct(db, { quantity: 10 })
})

afterEach(() => {
  vi.useRealTimers()
})

const stock = () => db.select().from(products).where(eq(products.id, product)).get()!.quantity
const sell = (quantity: number, by?: typeof kasun) =>
  sellProduct(db, { productId: product, quantity, paymentType: 'CASH' }, by)

describe('stock', () => {
  it('adds a delivery to what is in stock now, so a sale made meanwhile still counts', () => {
    sell(2, kasun)
    expect(receiveStock(db, { productId: product, quantity: 12 })).toEqual({
      productName: 'Yeti Isotonic',
      change: 12,
      quantityAfter: 20
    })
    expect(stock()).toBe(20)
  })

  it('sets the stock to a count, and keeps who changed what', () => {
    expect(countStock(db, { productId: product, quantity: 7 }, nimali)).toMatchObject({ change: -3, quantityAfter: 7 })
    at(10, 5)
    receiveStock(db, { productId: product, quantity: 5 })
    expect(listStockChanges(db, { from: today, to: today })).toEqual([
      expect.objectContaining({ kind: 'RECEIVED', change: 5, quantityAfter: 12, recordedBy: null, changedAt: `${today}T10:05:00` }),
      expect.objectContaining({ kind: 'COUNT', change: -3, quantityAfter: 7, recordedBy: 'Nimali', productName: 'Yeti Isotonic' })
    ])
  })

  it('refuses a delivery of nothing and a negative count', () => {
    expect(() => receiveStock(db, { productId: product, quantity: 0 })).toThrow()
    expect(() => countStock(db, { productId: product, quantity: -1 })).toThrow()
    expect(stock()).toBe(10)
    expect(listStockChanges(db, { from: today, to: today })).toEqual([])
  })

  it('leaves stock alone when a product is edited', () => {
    sell(3, kasun)
    // A form opened before the sale, still saying 10, can't put the sold items back.
    updateProduct(db, product, { name: 'Yeti', productType: 'BEVERAGE', price: 245, sellingPrice: 400, quantity: 10 } as never)
    const edited = db.select().from(products).where(eq(products.id, product)).get()!
    expect(edited).toMatchObject({ name: 'Yeti', sellingPrice: 400, quantity: 7 })
  })
})

describe('who bought it', () => {
  it('records the member, shows them on the sale, their details and the receipt', () => {
    const nimal = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567' })
    const sale = sellProduct(db, { productId: product, quantity: 1, paymentType: 'CASH', memberId: nimal }, kasun)
    sellProduct(db, { productId: product, quantity: 1, paymentType: 'CASH' })

    const listed = listPayments(db, { from: today, to: today })
    expect(listed.find((p) => p.id === sale)).toMatchObject({ memberId: nimal, memberName: 'Nimal Perera' })
    expect(listed.filter((p) => p.memberId === null)).toHaveLength(1)
    expect(paymentsForMember(db, nimal).map((p) => p.id)).toEqual([sale])
    expect(getReceipt(db, sale).members).toEqual([
      { id: nimal, firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567' }
    ])
    expect(deviceSalesToday(db, 'phone-1')[0].memberName).toBe('Nimal Perera')
  })

  it('refuses a member who no longer exists', () => {
    expect(() => sellProduct(db, { productId: product, quantity: 1, paymentType: 'CASH', memberId: 'gone' })).toThrow(
      /no longer exists/
    )
    expect(stock()).toBe(10)
  })

  it('keeps the sale when the member is deleted, and moves it when duplicates are merged', () => {
    const [keep, duplicate, leaving] = [1, 2, 3].map(() => seedMember(db))
    const merged = sellProduct(db, { productId: product, quantity: 1, paymentType: 'CASH', memberId: duplicate })
    const orphan = sellProduct(db, { productId: product, quantity: 1, paymentType: 'CASH', memberId: leaving })
    mergeMembers(db, keep, [duplicate])
    deleteMembers(db, [leaving])
    const byId = new Map(listPayments(db, { from: today, to: today }).map((p) => [p.id, p.memberId]))
    expect(byId.get(merged)).toBe(keep)
    expect(byId.get(orphan)).toBeNull()
  })

  it('finds members by name or part of their phone, giving only the last 3 digits', () => {
    seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '077 123 4567' })
    seedMember(db, { firstName: 'Nimali', lastName: 'Silva', mobileNumber: '0719876543' })
    seedMember(db, { firstName: 'Kamal', lastName: 'Perera', mobileNumber: null })
    expect(memberChoices(db, 'nimal').map((m) => m.name)).toEqual(['Nimal Perera', 'Nimali Silva'])
    expect(memberChoices(db, 'perera kam')).toEqual([expect.objectContaining({ name: 'Kamal Perera', phoneEnding: null })])
    expect(memberChoices(db, '0771 234')).toEqual([expect.objectContaining({ name: 'Nimal Perera', phoneEnding: '567' })])
    expect(memberChoices(db, 'n')).toEqual([])
    expect(memberChoices(db, '07')).toEqual([])
    for (let i = 0; i < 25; i++) seedMember(db, { firstName: `Saman${i}`, lastName: 'Kumara' })
    expect(memberChoices(db, 'saman')).toHaveLength(20)
  })

  it('offers today’s check-ins first, latest first', () => {
    const [early, late] = [1, 2].map(() => seedMember(db))
    checkIn(db, early, 'DOOR')
    at(11, 0)
    checkIn(db, late, 'DOOR')
    expect(checkedInToday(db).map((m) => m.id)).toEqual([late, early])
  })
})

describe('sales on instructors’ phones', () => {
  it('records who sold it', () => {
    sell(1, kasun)
    sell(1)
    expect(listPayments(db, { from: today, to: today }).map((p) => p.recordedBy).sort()).toEqual(['Kasun', null])
  })

  it('lists only a phone’s own sales for today', () => {
    sell(2, kasun)
    sell(1, nimali)
    sell(1)
    expect(deviceSalesToday(db, 'phone-1')).toEqual([
      expect.objectContaining({ productName: 'Yeti Isotonic', quantity: 2, amount: 700, paymentType: 'CASH', undoSecondsLeft: 600 })
    ])
  })

  it('lets a phone undo its own sale for 10 minutes, putting the stock back', () => {
    const mine = sell(2, kasun)
    const theirs = sell(1, nimali)
    const desk = sell(1)
    expect(stock()).toBe(6)
    expect(() => undoSale(db, theirs, 'phone-1')).toThrow(/wasn’t recorded on this phone/)
    expect(() => undoSale(db, desk, 'phone-1')).toThrow(/wasn’t recorded on this phone/)

    at(10, 9)
    expect(undoSale(db, mine, 'phone-1')).toMatchObject({ quantity: 2, amount: 700 })
    expect(stock()).toBe(8)

    const late = sell(1, kasun)
    at(10, 20)
    expect(deviceSalesToday(db, 'phone-1')[0].undoSecondsLeft).toBe(0)
    expect(() => undoSale(db, late, 'phone-1')).toThrow(/over 10 minutes/)
    expect(stock()).toBe(7)
  })
})

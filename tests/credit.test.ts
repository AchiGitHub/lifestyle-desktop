import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { creditSales, products } from '../src/main/db/schema'
import {
  deleteCreditSale,
  listCreditSales,
  memberCredit,
  owedList,
  payCredit,
  recordCreditReminder
} from '../src/main/services/credit'
import { deleteMembers, getMember, mergeMembers } from '../src/main/services/members'
import { deletePayment, listPayments } from '../src/main/services/payments'
import { deviceSalesToday, sellProduct, undoSale } from '../src/main/services/products'
import { getReceipt } from '../src/main/services/receipts'
import { prepareOwedReminder } from '../src/main/services/reminders'
import { dashboardReport } from '../src/main/services/reports'
import { STORE_CATEGORIES } from '../src/shared/enums'
import { makeDb, seedMember, seedProduct } from './helpers'

let db: Db
let yeti: string
let whey: string
let nimal: string
const kasun = { deviceId: 'phone-1', name: 'Kasun' }
const at = (day: number, hour = 10, minute = 0) => vi.setSystemTime(new Date(2026, 9, day, hour, minute))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(20)
  db = makeDb()
  yeti = seedProduct(db, { quantity: 10, sellingPrice: 350 })
  whey = seedProduct(db, { name: 'Whey Protein', productType: 'SUPPLEMENT', quantity: 3, sellingPrice: 12000 })
  nimal = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567' })
})

afterEach(() => {
  vi.useRealTimers()
})

const product = (id: string) => db.select().from(products).where(eq(products.id, id)).get()!
const onCredit = (productId: string, quantity: number, memberId = nimal, by?: typeof kasun) =>
  sellProduct(db, { productId, quantity, paymentType: 'CREDIT', memberId }, by)
const october = { from: '2026-10-01', to: '2026-10-31' }

describe('selling on credit', () => {
  it('needs a member to chase', () => {
    expect(() => sellProduct(db, { productId: yeti, quantity: 1, paymentType: 'CREDIT' })).toThrow(/only members can pay later/)
    expect(product(yeti).quantity).toBe(10)
  })

  it('takes the items out of stock but takes no money', () => {
    onCredit(yeti, 2)
    expect(product(yeti)).toMatchObject({ quantity: 8, sold: 2 })
    expect(listPayments(db, october)).toEqual([])
    expect(dashboardReport(db, '2026-10').months.at(-1)!.store).toBe(0)
    expect(owedList(db)).toEqual([
      expect.objectContaining({
        memberId: nimal,
        firstName: 'Nimal',
        owed: 700,
        items: [expect.objectContaining({ productName: 'Yeti Isotonic', quantity: 2, amount: 700, owed: 700 })],
        lastPaidAt: null,
        remindedAt: null
      })
    ])
  })

  it('keeps the product name for the reminder after the product is deleted', () => {
    onCredit(yeti, 1)
    db.delete(products).where(eq(products.id, yeti)).run()
    expect(memberCredit(db, nimal).items[0].productName).toBe('Yeti Isotonic')
  })
})

describe('paying it off', () => {
  beforeEach(() => {
    onCredit(yeti, 2) // 700, 20 Oct
    at(22)
    onCredit(whey, 1) // 12,000, 22 Oct
    at(25)
  })

  it('pays off the oldest items first, and counts as store income the day it is paid', () => {
    const id = payCredit(db, { memberId: nimal, amount: 1000, paymentType: 'CASH' })
    const credit = memberCredit(db, nimal)
    expect(credit.owed).toBe(11700)
    expect(credit.items).toEqual([expect.objectContaining({ productName: 'Whey Protein', amount: 12000, owed: 11700 })])
    expect(credit.lastPaidAt).toBe('2026-10-25T10:00:00')
    expect(listCreditSales(db, october).map((s) => [s.productName, s.owed])).toEqual([
      ['Whey Protein', 11700],
      ['Yeti Isotonic', 0]
    ])

    expect(listPayments(db, { from: '2026-10-25', to: '2026-10-25' })).toEqual([
      expect.objectContaining({ id, amount: 1000, category: 'STORE_CREDIT', description: 'Store items on credit', memberName: 'Nimal Perera' })
    ])
    expect(dashboardReport(db, '2026-10').months.at(-1)!).toMatchObject({ store: 1000, income: 1000 })
  })

  it('shows under Store → Sales once paid, adding up to the store income', () => {
    sellProduct(db, { productId: yeti, quantity: 1, paymentType: 'CASH' })
    expect(listPayments(db, { ...october, categories: STORE_CATEGORIES }).map((p) => p.amount)).toEqual([350])

    const id = payCredit(db, { memberId: nimal, amount: 1000, paymentType: 'CASH' })
    const sales = listPayments(db, { ...october, categories: STORE_CATEGORIES })
    expect(sales.map((p) => p.id)).toContain(id)
    expect(sales.reduce((s, p) => s + p.amount, 0)).toBe(1350)
    expect(dashboardReport(db, '2026-10').months.at(-1)!.store).toBe(1350)
  })

  it('gives a receipt that says what is still to pay, the same when printed again', () => {
    const first = payCredit(db, { memberId: nimal, amount: 700, paymentType: 'CASH' })
    expect(getReceipt(db, first)).toMatchObject({
      item: 'Store items on credit',
      detail: 'Rs. 12,000 still to pay after this',
      members: [expect.objectContaining({ id: nimal })]
    })
    const second = payCredit(db, { memberId: nimal, amount: 12000, paymentType: 'CARD' })
    expect(getReceipt(db, second).detail).toBe('All paid off with this payment')
    expect(getReceipt(db, first).detail).toBe('Rs. 12,000 still to pay after this')
    expect(owedList(db)).toEqual([])
  })

  it('refuses more than they owe, and a payment when they owe nothing', () => {
    expect(() => payCredit(db, { memberId: nimal, amount: 12701, paymentType: 'CASH' })).toThrow('They only owe Rs. 12,700.')
    payCredit(db, { memberId: nimal, amount: 12700, paymentType: 'CASH' })
    expect(() => payCredit(db, { memberId: nimal, amount: 1, paymentType: 'CASH' })).toThrow(/don’t owe anything/)
  })

  it('owes again when a payment is deleted', () => {
    const id = payCredit(db, { memberId: nimal, amount: 12700, paymentType: 'CASH' })
    deletePayment(db, id)
    expect(memberCredit(db, nimal).owed).toBe(12700)
    // Nothing goes back into stock: the payment wasn't for products.
    expect(product(whey).quantity).toBe(2)
  })
})

describe('mistakes', () => {
  it('deleting a credit sale takes it off what they owe and puts the items back', () => {
    const id = onCredit(yeti, 3)
    deleteCreditSale(db, id)
    expect(product(yeti)).toMatchObject({ quantity: 10, sold: 0 })
    expect(owedList(db)).toEqual([])
  })

  it("won't delete one if what they've paid would then be more than they took", () => {
    const id = onCredit(yeti, 2)
    payCredit(db, { memberId: nimal, amount: 500, paymentType: 'CASH' })
    expect(() => deleteCreditSale(db, id)).toThrow('They only owe Rs. 200, so without this they’d have paid too much.')
    expect(product(yeti).quantity).toBe(8)
  })

  it('what they paid for a deleted item goes towards their other items', () => {
    const first = onCredit(yeti, 1) // 350
    at(21)
    onCredit(yeti, 2) // 700
    payCredit(db, { memberId: nimal, amount: 525, paymentType: 'CASH' }) // the first is paid off
    deleteCreditSale(db, first)
    expect(memberCredit(db, nimal)).toMatchObject({ owed: 175, items: [expect.objectContaining({ quantity: 2, owed: 175 })] })
  })

  it('an instructor can undo their own sale on credit for 10 minutes', () => {
    const id = onCredit(yeti, 2, nimal, kasun)
    expect(deviceSalesToday(db, kasun.deviceId)).toEqual([
      expect.objectContaining({ id, paymentType: 'CREDIT', amount: 700, memberName: 'Nimal Perera' })
    ])
    at(20, 10, 5)
    expect(undoSale(db, id, kasun.deviceId)).toMatchObject({ paymentType: 'CREDIT' })
    expect(product(yeti).quantity).toBe(10)
    expect(owedList(db)).toEqual([])

    const late = onCredit(yeti, 1, nimal, kasun)
    at(20, 10, 16)
    expect(() => undoSale(db, late, kasun.deviceId)).toThrow(/over 10 minutes/)
  })
})

describe('members', () => {
  it('shows store credit in their details', () => {
    onCredit(yeti, 2)
    expect(getMember(db, nimal).credit).toMatchObject({ owed: 700, items: [expect.objectContaining({ quantity: 2 })] })
  })

  it('merging duplicates keeps what they owe', () => {
    const duplicate = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567' })
    onCredit(yeti, 2, duplicate)
    recordCreditReminder(db, duplicate)
    mergeMembers(db, nimal, [duplicate])
    const credit = memberCredit(db, nimal)
    expect(credit.owed).toBe(700)
    expect(credit.remindedAt).not.toBeNull()
  })

  it("can't delete someone who owes; once paid, their credit history goes with them", () => {
    onCredit(yeti, 2)
    expect(() => deleteMembers(db, [nimal])).toThrow('Nimal Perera owes Rs. 700 for store items')
    const paid = payCredit(db, { memberId: nimal, amount: 700, paymentType: 'CASH' })
    deleteMembers(db, [nimal])
    expect(db.select().from(creditSales).all()).toEqual([])
    // The money taken stays in the takings.
    expect(listPayments(db, october)).toEqual([expect.objectContaining({ id: paid, memberId: null })])
  })
})

describe('reminder', () => {
  it('says how much and for what', () => {
    onCredit(yeti, 2)
    at(22)
    onCredit(whey, 1)
    payCredit(db, { memberId: nimal, amount: 200, paymentType: 'CASH' })
    const { phone, text } = prepareOwedReminder(db, nimal)
    expect(phone).toBe('94771234567')
    expect(text).toContain('Hi Nimal')
    expect(text).toContain('Rs. 12,500 to pay')
    expect(text).toContain('• 20 Oct: Yeti Isotonic × 2 (Rs. 500 left of Rs. 700)\n• 22 Oct: Whey Protein × 1 – Rs. 12,000')
  })

  it("isn't sent when they owe nothing or have no usable number", () => {
    expect(() => prepareOwedReminder(db, nimal)).toThrow(/doesn’t owe anything/)
    const noPhone = seedMember(db, { firstName: 'Saman', mobileNumber: '123' })
    onCredit(yeti, 1, noPhone)
    expect(() => prepareOwedReminder(db, noPhone)).toThrow(/can't be used for WhatsApp/)
  })
})

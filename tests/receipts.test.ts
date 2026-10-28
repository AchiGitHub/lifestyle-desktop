import { randomUUID } from 'node:crypto'
import { asc } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments, products } from '../src/main/db/schema'
import { receiptHtml } from '../src/main/print/html'
import { addPayment, deletePayment, numberReceipts } from '../src/main/services/payments'
import { sellProduct } from '../src/main/services/products'
import {
  getReceipt,
  receiptRecipient,
  receiptSettings,
  saveReceiptSettings
} from '../src/main/services/receipts'
import { createRegistration } from '../src/main/services/registrations'
import { addDays, todayIso } from '../src/shared/dates'
import { receiptText } from '../src/shared/receipts'
import { makeDb, memberData, seedPlan } from './helpers'

let db: Db
const today = todayIso()

beforeEach(() => {
  db = makeDb()
})

function register(paid: number, members = [memberData()]) {
  return createRegistration(db, {
    membershipTypeId: seedPlan(db, { members: members.length, price: 18000 }),
    startDate: today,
    endDate: addDays(today, 30),
    amount: 18000,
    members: members.map((member) => ({ kind: 'new' as const, member })),
    payment: { amount: paid, paymentType: 'CASH' }
  })
}

function seedProduct(): string {
  const id = randomUUID()
  db.insert(products)
    .values({ id, name: 'Yeti Isotonic', productType: 'BEVERAGE', quantity: 10, price: 250, sellingPrice: 350 })
    .run()
  return id
}

const receiptNo = (id: string) => getReceipt(db, id).number

describe('receipt numbers', () => {
  it('numbers every new payment in turn, and never reuses a deleted one', () => {
    const reg = register(10000)
    const added = addPayment(db, { registrationId: reg.id, amount: 3000, paymentType: 'CARD' })
    const sold = sellProduct(db, { productId: seedProduct(), quantity: 2, paymentType: 'CASH' })
    expect([reg.paymentId!, added, sold].map(receiptNo)).toEqual(['R-00001', 'R-00002', 'R-00003'])

    deletePayment(db, sold)
    const next = addPayment(db, { registrationId: reg.id, amount: 1000, paymentType: 'CASH' })
    expect(receiptNo(next)).toBe('R-00004')
  })

  it('gives no payment when nothing was paid at sign-up', () => {
    expect(register(0).paymentId).toBeNull()
  })

  it('numbers old payments in date order, after any existing numbers', () => {
    const reg = register(1000) // R-00001
    for (const paidAt of ['2025-03-01T10:00:00', null, '2024-12-31T09:00:00']) {
      db.insert(payments)
        .values({ id: randomUUID(), registrationId: reg.id, amount: 1, paymentType: 'CASH', category: 'MEMBERSHIP', paidAt })
        .run()
    }
    numberReceipts(db)
    const rows = db.select().from(payments).orderBy(asc(payments.receiptNo)).all()
    expect(rows.map((p) => [p.receiptNo, p.paidAt?.slice(0, 10) ?? null])).toEqual([
      [1, today],
      [2, null],
      [3, '2024-12-31'],
      [4, '2025-03-01']
    ])
  })
})

describe('receipt content', () => {
  it('shows the balance as it stood after each payment', () => {
    const reg = register(10000)
    const rest = addPayment(db, { registrationId: reg.id, amount: 8000, paymentType: 'ONLINE' })

    const first = getReceipt(db, reg.paymentId!)
    expect(first.registration).toEqual({ total: 18000, joiningFee: 0, paid: 10000, balance: 8000 })
    expect(first.members.map((m) => m.firstName)).toEqual(['Nimal'])
    expect(first.detail).toMatch(/^\d+ \w+ \d{4} – \d+ \w+ \d{4}$/)

    const second = getReceipt(db, rest)
    expect(second.method).toBe('ONLINE')
    expect(second.registration).toEqual({ total: 18000, joiningFee: 0, paid: 18000, balance: 0 })
  })

  it('describes store sales and migrated payments', () => {
    const sale = getReceipt(db, sellProduct(db, { productId: seedProduct(), quantity: 2, paymentType: 'CARD' }))
    expect(sale).toMatchObject({ item: 'Yeti Isotonic', detail: '2 × Rs. 350', amount: 700, members: [], registration: null })

    const legacy = randomUUID()
    db.insert(payments)
      .values({ id: legacy, legacyRegistrationId: 'gone', amount: 5000, paymentType: 'CASH', category: 'MEMBERSHIP', paidAt: `${today}T08:00:00` })
      .run()
    expect(getReceipt(db, legacy)).toMatchObject({ item: 'Membership fee', registration: null })
  })

  it('reads well on WhatsApp', () => {
    const reg = register(10000)
    const text = receiptText(getReceipt(db, reg.paymentId!))
    expect(text).toContain('*Lifestyle Fitness Studio*')
    expect(text).toContain('Receipt R-00001 · ')
    expect(text).toContain('*Paid: Rs. 10,000* (Cash)')
    expect(text).toContain('Balance to pay: Rs. 8,000')
    expect(text.endsWith('Thank you!')).toBe(true)
  })

  it('escapes names in the printed receipt', () => {
    const reg = register(500, [memberData({ firstName: '<script>alert(1)</script>' })])
    const html = receiptHtml(getReceipt(db, reg.paymentId!))
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('sending and settings', () => {
  it('sends to a member on the receipt or a typed number', () => {
    const reg = register(1000)
    const receipt = getReceipt(db, reg.paymentId!)
    expect(receiptRecipient(receipt, { memberId: receipt.members[0].id })).toBe('94771234567')
    expect(receiptRecipient(receipt, { phone: '071 222 3333' })).toBe('94712223333')
    expect(() => receiptRecipient(receipt, { phone: '123' })).toThrow(/doesn't look right/)
    expect(() => receiptRecipient(receipt, { memberId: 'someone-else' })).toThrow(/isn't on this receipt/)
  })

  it('keeps the gym details, with defaults', () => {
    expect(receiptSettings(db).gymName).toBe('Lifestyle Fitness Studio')
    const custom = { gymName: 'LSFS', address: 'Kandy', phone: '081 222 3333', footer: 'See you soon', ownerPhone: '0771234567' }
    saveReceiptSettings(db, custom)
    expect(receiptSettings(db)).toEqual(custom)
    expect(getReceipt(db, register(100).paymentId!).gym.gymName).toBe('LSFS')
    expect(() => saveReceiptSettings(db, { ...custom, ownerPhone: '12' })).toThrow(/owner's WhatsApp/)
    expect(() => saveReceiptSettings(db, { ...custom, gymName: ' ' })).toThrow()
  })
})

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments } from '../src/main/db/schema'
import { payCredit, recordCreditReminder } from '../src/main/services/credit'
import { whoOwes } from '../src/main/services/owed'
import { addPayment } from '../src/main/services/payments'
import { sellProduct } from '../src/main/services/products'
import { prepareOwedReminder } from '../src/main/services/reminders'
import { createPtPackage, createPtRegistration, createTrainer, listPtPackages, listTrainers } from '../src/main/services/training'
import { makeDb, seedMember, seedPlan, seedProduct, seedRegistration } from './helpers'

let db: Db
let plan: string
let nimal: string
let membership: string
const at = (month: number, day: number) => vi.setSystemTime(new Date(2026, month - 1, day, 10, 0))

/** A membership with `paid` of its Rs. 10,000 paid. */
function registration(memberIds: string[], from: string, to: string, paid = 0): string {
  const id = seedRegistration(db, plan, memberIds, from, to)
  if (paid > 0) {
    db.insert(payments)
      .values({ id: randomUUID(), registrationId: id, amount: paid, paymentType: 'CASH', category: 'MEMBERSHIP', paidAt: `${from}T09:00:00` })
      .run()
  }
  return id
}

function personalTraining(memberId: string, paid: number) {
  createTrainer(db, { name: 'Kasun Silva', isOwner: false, commissionPercent: 30 })
  createPtPackage(db, { name: '12 sessions', sessions: 12, price: 24000, validDuration: 2, validDurationType: 'MONTH' })
  return createPtRegistration(db, {
    memberId,
    trainerId: listTrainers(db)[0].id,
    packageId: listPtPackages(db)[0].id,
    sessions: 12,
    startDate: '2026-10-20',
    endDate: '2026-12-19',
    amount: 24000,
    commission: 7200,
    payment: { amount: paid, paymentType: 'CASH' }
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(10, 20)
  db = makeDb()
  plan = seedPlan(db, { price: 10000 })
  nimal = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567' })
  membership = registration([nimal], '2026-10-01', '2026-10-31', 4000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('who owes', () => {
  it('puts a membership, personal training and store items owed by one member together, oldest first', () => {
    personalTraining(nimal, 10000)
    sellProduct(db, { productId: seedProduct(db, { sellingPrice: 350 }), quantity: 2, paymentType: 'CREDIT', memberId: nimal })

    const [owes, ...others] = whoOwes(db)
    expect(others).toEqual([])
    expect(owes).toMatchObject({ memberId: nimal, firstName: 'Nimal', mobileNumber: '0771234567', remindedAt: null })
    expect(owes.debts.map((d) => [d.kind, d.owed, d.since, d.older])).toEqual([
      ['MEMBERSHIP', 6000, '2026-10-01', false],
      ['PERSONAL_TRAINING', 14000, '2026-10-20', false],
      ['STORE_CREDIT', 700, '2026-10-20', false]
    ])
    // The personal training payment was the last one, today.
    expect(owes.lastPaidAt).toBe('2026-10-20T10:00:00')
  })

  it('leaves out what has been paid off, and anyone who owes nothing', () => {
    addPayment(db, { registrationId: membership, amount: 6000, paymentType: 'CARD' })
    expect(whoOwes(db)).toEqual([])
    sellProduct(db, { productId: seedProduct(db, { sellingPrice: 350 }), quantity: 1, paymentType: 'CREDIT', memberId: nimal })
    expect(whoOwes(db).map((m) => m.debts.map((d) => d.kind))).toEqual([['STORE_CREDIT']])
    payCredit(db, { memberId: nimal, amount: 350, paymentType: 'CASH' })
    expect(whoOwes(db)).toEqual([])
  })

  it('lists a couple’s membership once, under the one WhatsApp can reach', () => {
    const noPhone = seedMember(db, { firstName: 'Kamala', lastName: 'Silva', mobileNumber: 'N/A' })
    const withPhone = seedMember(db, { firstName: 'Sunil', lastName: 'Silva', mobileNumber: '0712345678' })
    const couple = registration([noPhone, withPhone], '2026-10-05', '2026-11-04')
    const rows = whoOwes(db).filter((m) => m.memberId !== nimal)
    expect(rows.map((m) => m.memberId)).toEqual([withPhone])
    const [debt] = rows[0].debts
    expect(debt.kind === 'MEMBERSHIP' && debt.registration.id).toBe(couple)
    expect(debt.owed).toBe(10000)
  })

  it('marks memberships that ended over a year ago as older, and puts them last', () => {
    const saman = seedMember(db, { firstName: 'Saman', mobileNumber: '0751234567' })
    const ruwan = seedMember(db, { firstName: 'Ruwan', mobileNumber: '0761234567' })
    registration([saman], '2025-09-01', '2025-09-30') // ended before 20 Oct 2025
    registration([ruwan], '2025-09-21', '2025-10-20') // ended on it: not older yet
    const rows = whoOwes(db)
    expect(rows.map((m) => [m.firstName, m.debts.map((d) => d.older)])).toEqual([
      ['Ruwan', [false]],
      ['Nimal', [false]],
      ['Saman', [true]]
    ])
  })

  it('shows when they were last messaged about it, but not about something from before', () => {
    at(9, 15)
    recordCreditReminder(db, nimal)
    at(10, 20)
    expect(whoOwes(db)[0].remindedAt).toBeNull()
    recordCreditReminder(db, nimal)
    expect(whoOwes(db)[0].remindedAt).toBe(new Date(2026, 9, 20, 10, 0).toISOString())
  })
})

describe('reminder of what they owe', () => {
  it('lists everything, with the total', () => {
    personalTraining(nimal, 10000)
    sellProduct(db, { productId: seedProduct(db, { sellingPrice: 350 }), quantity: 2, paymentType: 'CREDIT', memberId: nimal })
    const { phone, text } = prepareOwedReminder(db, nimal)
    expect(phone).toBe('94771234567')
    expect(text).toContain('Hi Nimal')
    expect(text).toContain('Rs. 20,700 to pay:')
    expect(text).toMatch(
      /\n• Plan \w+ membership from 1 Oct 2026 – Rs\. 6,000\n• Personal training, 12 sessions with Kasun Silva – Rs\. 14,000\n• 20 Oct: Yeti Isotonic × 2 – Rs\. 700\n/
    )
  })

  it('leaves out balances that ended over a year ago unless they are shown', () => {
    const saman = seedMember(db, { firstName: 'Saman', mobileNumber: '0751234567' })
    registration([saman], '2025-01-01', '2025-01-31', 2500)
    expect(() => prepareOwedReminder(db, saman)).toThrow('Saman doesn’t owe anything.')
    expect(prepareOwedReminder(db, saman, true).text).toContain('Rs. 7,500 to pay:\n• Plan')
  })
})

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments, registrations } from '../src/main/db/schema'
import { dashboardReport } from '../src/main/services/reports'
import type { PaymentCategory, PaymentType } from '../src/shared/enums'
import { makeDb, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
let plan: string

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 28, 12)) // 28 Oct 2026
  db = makeDb()
  plan = seedPlan(db)
})

afterEach(() => {
  vi.useRealTimers()
})

function pay(amount: number, paymentType: PaymentType, category: PaymentCategory, paidAt: string) {
  db.insert(payments).values({ id: randomUUID(), registrationId: null, amount, paymentType, category, paidAt }).run()
}

describe('dashboard report', () => {
  beforeEach(() => {
    const [renewer, lapsed, newcomer, future, dismissed] = [1, 2, 3, 4, 5].map(() => seedMember(db))
    seedRegistration(db, plan, [renewer], '2026-09-01', '2026-09-30')
    seedRegistration(db, plan, [renewer], '2026-10-01', '2026-10-31') // a renewal, ending this month
    seedRegistration(db, plan, [lapsed], '2026-09-15', '2026-10-14') // ended, not renewed
    seedRegistration(db, plan, [newcomer], '2026-10-20', '2026-11-19')
    seedRegistration(db, plan, [future], '2026-10-30', '2026-11-29') // hasn't started yet
    const gone = seedRegistration(db, plan, [dismissed], '2026-08-01', '2026-10-05')
    db.update(registrations).set({ dismissedAt: '2026-10-06T00:00:00Z' }).where(eq(registrations.id, gone)).run()

    pay(10000, 'CASH', 'MEMBERSHIP', '2026-09-05T09:00:00')
    pay(500, 'CASH', 'BEVERAGE', '2026-09-29T18:00:00') // after the 28th: not in the comparison
    pay(12000, 'CARD', 'MEMBERSHIP', '2026-10-02T09:00:00')
    pay(300, 'CASH', 'BEVERAGE', '2026-10-27T18:00:00')
  })

  it('covers the chosen month and the 11 before it, the current one up to today', () => {
    const { months } = dashboardReport(db, '2026-10')
    expect(months.map((m) => m.month)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'
    ])
    const [sep, oct] = months.slice(-2)
    expect(oct).toEqual({
      month: '2026-10',
      partial: true,
      through: '2026-10-28',
      income: 12300,
      memberships: 12000,
      personalTraining: 0,
      store: 300,
      newSignUps: 1,
      renewals: 1,
      activeMembers: 2,
      ending: 3,
      renewed: 0
    })
    expect(sep).toMatchObject({
      partial: false,
      through: '2026-09-30',
      income: 10500,
      newSignUps: 2,
      renewals: 0,
      activeMembers: 3,
      ending: 1,
      renewed: 1
    })
    expect(months[0]).toMatchObject({ income: 0, activeMembers: 0, ending: 0 })
  })

  it('compares a month in progress with the same days of the month before', () => {
    const r = dashboardReport(db, '2026-10')
    expect(r.previous).toEqual({
      from: '2026-09-01',
      to: '2026-09-28',
      income: 10000,
      memberships: 10000,
      personalTraining: 0,
      store: 0,
      newSignUps: 2,
      renewals: 0
    })
    expect(r.byPaymentType).toEqual({ CASH: 300, CARD: 12000, ONLINE: 0 })
    expect(r.toRenew).toBe(2) // the dismissed one isn't chased
    expect(r.byPlan).toEqual([expect.objectContaining({ membershipTypeId: plan, count: 2, amount: 20000 })])
  })

  it('compares a finished month with the whole month before', () => {
    const r = dashboardReport(db, '2026-09')
    expect(r.months.at(-1)).toMatchObject({ month: '2026-09', partial: false })
    expect(r.previous).toMatchObject({ from: '2026-08-01', to: '2026-08-31', income: 0, newSignUps: 1 })
  })

  it('shows this month for a later month, and refuses anything that isn’t a month', () => {
    expect(dashboardReport(db, '2027-01').months.at(-1)!.month).toBe('2026-10')
    expect(() => dashboardReport(db, 'October')).toThrow()
  })

  it('stops the comparison at the end of a shorter month', () => {
    vi.setSystemTime(new Date(2026, 2, 31, 12)) // 31 Mar 2026
    expect(dashboardReport(db, '2026-03').previous).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })
})

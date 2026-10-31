import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments, ptRegistrations, registrations, trainers, visits } from '../src/main/db/schema'
import { birthdaysOn, calendarDays } from '../src/main/services/calendar'
import { createClassSeries, listClassTypes } from '../src/main/services/classes'
import { startingRegistrations } from '../src/main/services/registrations'
import { dashboardReport } from '../src/main/services/reports'
import { makeDb, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
let plan: string

const day = (date: string) => calendarDays(db, { from: date, to: date })[0]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 18, 9, 0))
  db = makeDb()
  plan = seedPlan(db)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('calendarDays', () => {
  it('returns every day of the range, oldest first, even empty ones', () => {
    const days = calendarDays(db, { from: '2026-10-30', to: '2026-11-02' })
    expect(days.map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(days[0]).toMatchObject({ classes: [], takings: 0, due: 0, birthdays: 0 })
  })

  it("puts each day's classes on it, repeating ones included", () => {
    const classTypeId = listClassTypes(db)[0].id
    createClassSeries(db, {
      classTypeId,
      weekdays: [3],
      startTime: '18:00',
      minutes: 45,
      trainerId: null,
      startsOn: '2026-11-01',
      endsOn: null
    })
    const days = calendarDays(db, { from: '2026-11-16', to: '2026-11-22' })
    expect(days.filter((d) => d.classes.length).map((d) => d.date)).toEqual(['2026-11-18'])
  })

  it('adds up takings and check-ins for the day', () => {
    const memberId = seedMember(db)
    for (const amount of [1000, 2500]) {
      db.insert(payments)
        .values({ id: randomUUID(), amount, paymentType: 'CASH', category: 'OTHER', paidAt: '2026-11-10T10:00:00' })
        .run()
    }
    db.insert(visits)
      .values({ id: randomUUID(), memberId, checkedInAt: '2026-11-10T08:00:00', source: 'DOOR', status: 'OK' })
      .run()
    expect(day('2026-11-10')).toMatchObject({ takings: 3500, checkIns: 1 })
  })

  it('counts memberships still to follow up, as Renewals due does', () => {
    const renewed = seedMember(db)
    seedRegistration(db, plan, [seedMember(db)], '2026-10-20', '2026-11-19')
    seedRegistration(db, plan, [renewed], '2026-10-20', '2026-11-19')
    seedRegistration(db, plan, [renewed], '2026-11-20', '2026-12-19')
    const dismissed = seedRegistration(db, plan, [seedMember(db)], '2026-10-20', '2026-11-19')
    db.update(registrations).set({ dismissedAt: '2026-11-01T00:00:00Z' }).where(eq(registrations.id, dismissed)).run()

    expect(day('2026-11-19').due).toBe(1)
  })

  it('dates sign-ups by when they start, so a month adds up to the dashboard', () => {
    const member = seedMember(db)
    seedRegistration(db, plan, [member], '2026-09-01', '2026-09-30')
    // Entered today, backdated to the 2nd: created_at says the 18th.
    seedRegistration(db, plan, [member], '2026-11-02', '2026-11-30')
    seedRegistration(db, plan, [seedMember(db)], '2026-11-02', '2026-11-30')

    expect(day('2026-11-02')).toMatchObject({ newSignUps: 1, renewals: 1 })
    expect(day('2026-11-18')).toMatchObject({ newSignUps: 0, renewals: 0 })

    const month = calendarDays(db, { from: '2026-11-01', to: '2026-11-30' })
    const [figures] = dashboardReport(db, '2026-11').months.slice(-1)
    expect(month.reduce((n, d) => n + d.newSignUps, 0)).toBe(figures.newSignUps)
    expect(month.reduce((n, d) => n + d.renewals, 0)).toBe(figures.renewals)
    expect(startingRegistrations(db, { from: '2026-11-02', to: '2026-11-02' })).toHaveLength(2)
  })

  it('counts personal training packages ending with sessions left', () => {
    const memberId = seedMember(db)
    db.insert(trainers).values({ id: 'kasun', name: 'Kasun' }).run()
    const pt = (id: string, sessions: number) =>
      db
        .insert(ptRegistrations)
        .values({
          id,
          memberId,
          trainerId: 'kasun',
          packageName: 'Ten',
          sessions,
          startDate: '2026-10-01',
          endDate: '2026-11-25',
          amount: 5000
        })
        .run()
    pt('left', 2)
    pt('used-up', 1)
    db.insert(visits)
      .values({
        id: randomUUID(),
        memberId,
        checkedInAt: '2026-11-10T08:00:00',
        source: 'DOOR',
        status: 'OK',
        ptRegistrationId: 'used-up'
      })
      .run()

    expect(day('2026-11-25').ptEnding).toBe(1)
  })

  it('finds birthdays in any year', () => {
    seedMember(db, { dob: '1990-11-05' })
    seedMember(db, { dob: '2001-11-05' })
    seedMember(db, { dob: '2001-11-06' })
    seedMember(db, { dob: null })

    expect(day('2026-11-05').birthdays).toBe(2)
    expect(day('2027-11-06').birthdays).toBe(1)
  })
})

describe('birthdaysOn', () => {
  it('names who has a birthday and the age they reach', () => {
    seedMember(db, { firstName: 'Zara', lastName: 'Perera', dob: '1990-11-05' })
    seedMember(db, { firstName: 'Amal', lastName: 'Silva', dob: '2001-11-05' })
    seedMember(db, { firstName: 'Nimal', lastName: 'Fernando', dob: '2001-11-06' })

    expect(birthdaysOn(db, '2026-11-05')).toMatchObject([
      { name: 'Amal Silva', turns: 25 },
      { name: 'Zara Perera', turns: 36 }
    ])
  })
})

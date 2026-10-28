import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments, visits } from '../src/main/db/schema'
import { deleteMembers, getMember, mergeMembers } from '../src/main/services/members'
import { checkIn, deleteVisit, findForCheckIn, listVisits } from '../src/main/services/visits'
import { addDays, todayIso } from '../src/shared/dates'
import { makeDb, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
let plan: string
const today = todayIso()

beforeEach(() => {
  db = makeDb()
  plan = seedPlan(db)
})

/** A registration (Rs 10,000), paid in full unless told otherwise. */
function register(memberId: string, start: string, end: string, paid = 10000): string {
  const id = seedRegistration(db, plan, [memberId], start, end)
  if (paid) {
    db.insert(payments)
      .values({ id: randomUUID(), registrationId: id, amount: paid, paymentType: 'CASH', category: 'MEMBERSHIP', paidAt: `${start}T09:00:00` })
      .run()
  }
  return id
}

describe('finding members at the door', () => {
  it('matches the number however it was typed, showing only first name and initial', () => {
    const id = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '077 123 4567' })
    expect(findForCheckIn(db, '0771234567')).toEqual([{ id, name: 'Nimal P.' }])
    expect(findForCheckIn(db, '+94 77 123 4567')).toEqual([{ id, name: 'Nimal P.' }])
    expect(findForCheckIn(db, '12345')).toEqual([])
  })

  it('lists each person on a shared phone once, preferring their latest record', () => {
    const phone = '0712223333'
    const oldRecord = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: phone })
    const current = seedMember(db, { firstName: 'NIMAL ', lastName: 'perera', mobileNumber: phone })
    const partner = seedMember(db, { firstName: 'Kamala', lastName: 'Perera', mobileNumber: phone })
    register(oldRecord, addDays(today, -400), addDays(today, -370))
    register(current, addDays(today, -10), addDays(today, 20))
    const found = findForCheckIn(db, phone)
    expect(found.map((f) => f.id).sort()).toEqual([current, partner].sort())
  })
})

describe('checking in', () => {
  it('records the member’s state: no plan, active, expired, owing', () => {
    const none = seedMember(db)
    expect(checkIn(db, none, 'DOOR')).toMatchObject({ status: 'NO_PLAN', endDate: null, repeat: false })

    const active = seedMember(db)
    register(active, addDays(today, -10), addDays(today, 20))
    expect(checkIn(db, active, 'DOOR')).toMatchObject({ status: 'OK', endDate: addDays(today, 20) })

    const lapsed = seedMember(db)
    register(lapsed, addDays(today, -40), addDays(today, -10))
    expect(checkIn(db, lapsed, 'DOOR')).toMatchObject({ status: 'EXPIRED', endDate: addDays(today, -10) })

    const owing = seedMember(db)
    register(owing, addDays(today, -5), addDays(today, 25), 4000)
    expect(checkIn(db, owing, 'DESK').status).toBe('OWES')
  })

  it('ignores an old unpaid balance once they have a current, paid membership', () => {
    const m = seedMember(db)
    register(m, addDays(today, -100), addDays(today, -70), 0)
    register(m, addDays(today, -5), addDays(today, 25))
    expect(checkIn(db, m, 'DOOR').status).toBe('OK')
  })

  it('records a second check-in only after 2 hours', () => {
    const m = seedMember(db)
    const start = new Date()
    const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000)
    expect(checkIn(db, m, 'DOOR', at(0)).visitId).not.toBeNull()
    expect(checkIn(db, m, 'DOOR', at(1))).toMatchObject({ visitId: null, repeat: true })
    expect(checkIn(db, m, 'DOOR', at(3)).visitId).not.toBeNull()
    expect(db.select().from(visits).all()).toHaveLength(2)
  })

  it('lists, removes and summarises visits', () => {
    const m = seedMember(db, { firstName: 'Kamal', lastName: 'Silva' })
    const { visitId } = checkIn(db, m, 'DESK')
    expect(listVisits(db, { from: today, to: today })).toMatchObject([{ memberName: 'Kamal Silva', source: 'DESK', status: 'NO_PLAN' }])
    expect(getMember(db, m).visits).toMatchObject({ last30Days: 1 })
    deleteVisit(db, visitId!)
    expect(listVisits(db, { from: today, to: today })).toEqual([])
    expect(getMember(db, m).visits).toEqual({ lastAt: null, last30Days: 0 })
  })

  it('keeps visits when duplicates are merged, and drops them with a deleted member', () => {
    const keep = seedMember(db)
    const dup = seedMember(db)
    checkIn(db, dup, 'DOOR')
    mergeMembers(db, keep, [dup])
    expect(db.select().from(visits).where(eq(visits.memberId, keep)).all()).toHaveLength(1)

    deleteMembers(db, [keep])
    expect(db.select().from(visits).all()).toEqual([])
  })
})

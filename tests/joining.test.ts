import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db/client'
import {
  durations,
  membershipTypes,
  payments,
  registrationMembers,
  registrations,
  settings
} from '../src/main/db/schema'
import { convertJoiningFeePlans } from '../src/main/db/upgrades'
import { saveJoiningFeeSettings } from '../src/main/services/joining'
import { listMembershipTypes } from '../src/main/services/plans'
import { createRegistration, getRegistration, updateRegistration } from '../src/main/services/registrations'
import { dashboardReport } from '../src/main/services/reports'
import { addDays, todayIso } from '../src/shared/dates'
import { joiningFeeAdvice } from '../src/shared/joining'
import type { RegistrationCreateInput } from '../src/shared/schemas'
import { makeDb, memberData, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
const today = todayIso()

beforeEach(() => {
  db = makeDb()
})

describe('joining fee rule', () => {
  it('is due for new members and after a break longer than the setting', () => {
    expect(joiningFeeAdvice(null, '2026-10-20', 10)).toEqual({ due: true, reason: 'New member' })
    // Ended 9 Oct, starts 10 Oct: no break.
    expect(joiningFeeAdvice('2026-10-09', '2026-10-10', 10)).toEqual({ due: false, reason: 'Renewing' })
    // Ended 1 Oct, starts 12 Oct: 10 days without a membership.
    expect(joiningFeeAdvice('2026-10-01', '2026-10-12', 10)).toEqual({ due: false, reason: 'Renewing after 10 days' })
    expect(joiningFeeAdvice('2026-10-01', '2026-10-13', 10)).toEqual({ due: true, reason: 'Back after a 11-day break' })
    // Renewing early: the new start is before the old end.
    expect(joiningFeeAdvice('2026-11-30', '2026-12-01', 10).due).toBe(false)
  })
})

describe('registering with joining fees', () => {
  let couple: string
  beforeEach(() => {
    couple = seedPlan(db, { members: 2, price: 18000 })
    db.update(membershipTypes).set({ joiningFee: 1500 }).where(eq(membershipTypes.id, couple)).run()
  })

  const register = (members: RegistrationCreateInput['members'], startDate = today) =>
    createRegistration(db, {
      membershipTypeId: couple,
      startDate,
      endDate: addDays(startDate, 30),
      amount: 18000,
      members,
      payment: { amount: 0, paymentType: 'CASH' }
    })
  const fees = (registrationId: string) =>
    db
      .select({ fee: registrationMembers.joiningFee })
      .from(registrationMembers)
      .where(eq(registrationMembers.registrationId, registrationId))
      .all()
      .map((r) => r.fee)
      .sort()

  it('charges each new member and adds it to the amount', () => {
    const reg = register([
      { kind: 'new', member: memberData({ firstName: 'Nimal' }) },
      { kind: 'new', member: memberData({ firstName: 'Kamala', mobileNumber: '0712223333' }) }
    ])
    expect(reg).toMatchObject({ amount: 21000, joiningFee: 3000, balance: 21000 })
    expect(fees(reg.id)).toEqual([1500, 1500])
  })

  it('follows the break rule for existing members, unless staff decide otherwise', () => {
    const regular = seedMember(db, { mobileNumber: '0711111111' })
    seedRegistration(db, couple, [regular], addDays(today, -30), addDays(today, -1))
    const lapsed = seedMember(db, { mobileNumber: '0722222222' })
    seedRegistration(db, couple, [lapsed], addDays(today, -60), addDays(today, -20))

    const usual = register([
      { kind: 'existing', memberId: regular },
      { kind: 'existing', memberId: lapsed }
    ])
    expect(usual.joiningFee).toBe(1500)

    saveJoiningFeeSettings(db, { breakDays: 30 })
    const longerRule = register([{ kind: 'existing', memberId: lapsed }])
    expect(longerRule.joiningFee).toBe(0)

    const decided = register([
      { kind: 'existing', memberId: regular, chargeJoiningFee: true },
      { kind: 'new', member: memberData({ mobileNumber: '0733333333' }), chargeJoiningFee: false }
    ])
    expect(decided).toMatchObject({ amount: 19500, joiningFee: 1500 })
  })

  it('keeps the amount at least the joining fees when edited', () => {
    const reg = register([{ kind: 'new', member: memberData() }])
    const edit = { membershipTypeId: couple, startDate: reg.startDate, endDate: reg.endDate }
    expect(() => updateRegistration(db, reg.id, { ...edit, amount: 1000 })).toThrow(/joining fees/)
    updateRegistration(db, reg.id, { ...edit, amount: 17500 })
    expect(getRegistration(db, reg.id)).toMatchObject({ amount: 17500, joiningFee: 1500 })
  })

  it('reports joining fees for the month’s registrations', () => {
    register([{ kind: 'new', member: memberData() }])
    expect(dashboardReport(db, today.slice(0, 7)).joiningFees).toBe(1500)
  })
})

describe('converting the old "with Reg." plans', () => {
  function plan(name: string, price: number, people = 1, durationId = monthId()): string {
    const id = randomUUID()
    db.insert(membershipTypes).values({ id, name, price, numberOfMembers: people, durationId }).run()
    return id
  }
  let month: string | undefined
  const monthId = () => {
    if (!month) {
      month = randomUUID()
      db.insert(durations).values({ id: month, duration: 1, durationType: 'MONTH' }).run()
    }
    return month
  }
  const reg = (typeId: string, memberIds: string[], amount: number, paid: number) => {
    const id = seedRegistration(db, typeId, memberIds, addDays(today, -40), addDays(today, -10))
    db.update(registrations).set({ amount }).where(eq(registrations.id, id)).run()
    if (paid) {
      db.insert(payments)
        .values({ id: randomUUID(), registrationId: id, amount: paid, paymentType: 'CASH', category: 'MEMBERSHIP', paidAt: `${today}T09:00:00` })
        .run()
    }
    return id
  }
  beforeEach(() => {
    month = undefined
  })

  it('moves registrations to the plain plan with the difference as joining fees', () => {
    const single = plan('One Month', 10000)
    const singleReg = plan('One Months with Reg.', 12000)
    const pair = plan('One Month Couple Package', 18000, 2)
    const pairReg = plan('One Month Couple with Reg', 21000, 2)
    const offPeak = plan('Off peak Three Months Couple with Reg', 42500, 2)
    const a = seedMember(db, { mobileNumber: '0711111111' })
    const b = seedMember(db, { mobileNumber: '0722222222' })
    const r1 = reg(singleReg, [a], 12000, 12000)
    const r2 = reg(pairReg, [a, b], 21000, 20000)
    const r3 = reg(offPeak, [a, b], 42500, 42500)

    const result = convertJoiningFeePlans(db)
    expect(result).toMatchObject({ registrations: 3, plansRemoved: 3, plansCreated: ['Off peak Three Months Couple'] })

    expect(getRegistration(db, r1)).toMatchObject({ membershipTypeId: single, amount: 12000, joiningFee: 2000, paid: 12000, balance: 0 })
    expect(getRegistration(db, r2)).toMatchObject({ membershipTypeId: pair, amount: 21000, joiningFee: 3000, paid: 20000, balance: 1000 })
    expect(getRegistration(db, r3)).toMatchObject({ membershipTypeName: 'Off peak Three Months Couple', joiningFee: 3000 })

    const plans = listMembershipTypes(db)
    expect(plans.map((p) => p.name).sort()).toEqual(['Off peak Three Months Couple', 'One Month', 'One Month Couple Package'])
    expect(plans.find((p) => p.id === single)?.joiningFee).toBe(2000)
    expect(plans.find((p) => p.id === pair)?.joiningFee).toBe(1500)
    expect(plans.find((p) => p.name === 'Off peak Three Months Couple')).toMatchObject({ price: 39500, joiningFee: 1500 })

    expect(convertJoiningFeePlans(db).registrations).toBe(0)
  })

  it('runs when an older backup is opened, once', () => {
    const file = join(tmpdir(), `joining-${Date.now()}.db`)
    const migrations = resolve(__dirname, '../drizzle')
    let conn = openDatabase(file, migrations)
    try {
      // An "old backup": a "with Reg." registration and no record of the upgrade.
      db = conn.db
      plan('Annual', 75000)
      const id = reg(plan('Annual With Reg.', 77000), [seedMember(db)], 77000, 77000)
      db.delete(settings).where(eq(settings.key, 'upgrade.joiningFeePlans')).run()
      conn.sqlite.close()

      conn = openDatabase(file, migrations)
      expect(getRegistration(conn.db, id)).toMatchObject({ membershipTypeName: 'Annual', joiningFee: 2000, amount: 77000 })
    } finally {
      conn.sqlite.close()
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
    }
  })
})

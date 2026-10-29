import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments } from '../src/main/db/schema'
import { deleteMembers, getMember, mergeMembers } from '../src/main/services/members'
import { listPayments } from '../src/main/services/payments'
import { getReceipt } from '../src/main/services/receipts'
import { dashboardReport } from '../src/main/services/reports'
import { daySummary } from '../src/main/services/summary'
import {
  addPtPayment,
  commissionReport,
  createPtPackage,
  createPtRegistration,
  createTrainer,
  deletePtPackage,
  deletePtRegistration,
  deleteTrainer,
  getPtRegistration,
  listPtPackages,
  listPtSessions,
  listTrainers,
  setPtPackageArchived,
  setTrainerArchived,
  updatePtRegistration
} from '../src/main/services/training'
import { checkIn, checkInOptions, deleteVisit, memberStatus } from '../src/main/services/visits'
import type { PtCreateInput } from '../src/shared/schemas'
import { makeDb, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
let nimal: string
let owner: string
let kasun: string
let twelve: string
const today = '2026-10-20'
const at = (day: number, hour = 10, minute = 0) => vi.setSystemTime(new Date(2026, 9, day, hour, minute))

/** A paid-up membership around today. */
function member(firstName: string, from = '2026-10-01', to = '2026-10-31'): string {
  const id = seedMember(db, { firstName, lastName: 'Perera' })
  const reg = seedRegistration(db, seedPlan(db), [id], from, to)
  db.insert(payments).values({ id: randomUUID(), registrationId: reg, amount: 10000, paymentType: 'CASH', category: 'MEMBERSHIP' }).run()
  return id
}

const sale = (overrides: Partial<PtCreateInput> = {}): PtCreateInput => ({
  memberId: nimal,
  trainerId: kasun,
  packageId: twelve,
  sessions: 12,
  startDate: today,
  endDate: '2026-12-19',
  amount: 24000,
  commission: 7200,
  payment: { amount: 0, paymentType: 'CASH' },
  ...overrides
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(20)
  db = makeDb()
  nimal = member('Nimal')
  createTrainer(db, { name: 'Owner', isOwner: true, commissionPercent: 25 })
  createTrainer(db, { name: 'Kasun Silva', isOwner: false, commissionPercent: 30 })
  ;[owner, kasun] = listTrainers(db).map((t) => t.id)
  createPtPackage(db, { name: '12 sessions', sessions: 12, price: 24000, validDuration: 2, validDurationType: 'MONTH' })
  twelve = listPtPackages(db)[0].id
})

afterEach(() => {
  vi.useRealTimers()
})

describe('trainers and session types', () => {
  it('the owner gets no commission, and the list puts them first', () => {
    expect(listTrainers(db).map((t) => [t.name, t.isOwner, t.commissionPercent])).toEqual([
      ['Owner', true, 0],
      ['Kasun Silva', false, 30]
    ])
  })

  it('can only be deleted while unused; archived ones can’t be sold', () => {
    createPtRegistration(db, sale())
    expect(() => deleteTrainer(db, kasun)).toThrow(/has 1 package, so they can't be deleted/)
    expect(() => deletePtPackage(db, twelve)).toThrow(/sold 1 time, so it can't be deleted/)
    setTrainerArchived(db, kasun, true)
    expect(() => createPtRegistration(db, sale())).toThrow('Kasun Silva is archived')
    setTrainerArchived(db, kasun, false)
    setPtPackageArchived(db, twelve, true)
    expect(() => createPtRegistration(db, sale())).toThrow('"12 sessions" is archived')
  })
})

describe('selling a package', () => {
  it('needs a membership that hasn’t ended', () => {
    const lapsed = member('Saman', '2026-08-01', '2026-10-19')
    const never = seedMember(db, { firstName: 'Ruwan' })
    expect(() => createPtRegistration(db, sale({ memberId: lapsed }))).toThrow('Saman has no current membership')
    expect(() => createPtRegistration(db, sale({ memberId: never }))).toThrow('Ruwan has no current membership')
  })

  it('keeps the commission for a trainer, none for the owner, never more than the price', () => {
    expect(createPtRegistration(db, sale()).commission).toBe(7200)
    expect(createPtRegistration(db, sale({ trainerId: owner, commission: 5000 })).commission).toBe(0)
    expect(() => createPtRegistration(db, sale({ commission: 30000 }))).toThrow('Can’t be more than the price')
  })

  it('takes a payment with a receipt, and the rest later', () => {
    const pt = createPtRegistration(db, sale({ payment: { amount: 10000, paymentType: 'CASH' } }))
    expect(pt).toMatchObject({ paid: 10000, balance: 14000, used: 0, left: 12, trainerName: 'Kasun Silva' })
    expect(getReceipt(db, pt.paymentId!)).toMatchObject({
      item: 'Personal training: 12 sessions',
      detail: '12 sessions with Kasun Silva · 20 Oct 2026 – 19 Dec 2026',
      members: [expect.objectContaining({ id: nimal })],
      registration: { total: 24000, joiningFee: 0, paid: 10000, balance: 14000 }
    })
    expect(() => addPtPayment(db, { ptRegistrationId: pt.id, amount: 15000, paymentType: 'CARD' })).toThrow(
      'Only Rs. 14,000 is still to pay.'
    )
    const rest = addPtPayment(db, { ptRegistrationId: pt.id, amount: 14000, paymentType: 'CARD' })
    expect(getReceipt(db, rest).registration).toMatchObject({ paid: 24000, balance: 0 })
    expect(getReceipt(db, pt.paymentId!).registration).toMatchObject({ balance: 14000 })
    expect(listPayments(db, { from: today, to: today }).map((p) => [p.description, p.category, p.memberName])).toEqual([
      ['Personal training: 12 sessions', 'PERSONAL_TRAINING', 'Nimal Perera'],
      ['Personal training: 12 sessions', 'PERSONAL_TRAINING', 'Nimal Perera']
    ])
  })

  it('counts as personal training income, not store', () => {
    createPtRegistration(db, sale({ payment: { amount: 24000, paymentType: 'ONLINE' } }))
    expect(dashboardReport(db, '2026-10').months.at(-1)).toMatchObject({
      personalTraining: 24000,
      store: 0,
      memberships: 0,
      income: 24000
    })
    expect(daySummary(db, today)).toMatchObject({ personalTraining: 24000, store: 0, total: 24000 })
  })

  it('a balance on a running package counts as owing at check-in', () => {
    createPtRegistration(db, sale())
    expect(memberStatus(db, nimal, today).status).toBe('OWES')
  })
})

describe('sessions at check-in', () => {
  it('offers packages that have started, haven’t ended and have sessions left, with a current membership', () => {
    const pt = createPtRegistration(db, sale({ startDate: '2026-10-21', endDate: '2026-12-20' }))
    expect(checkInOptions(db, nimal)).toEqual([])
    at(21)
    expect(checkInOptions(db, nimal)).toEqual([
      { ptRegistrationId: pt.id, trainerName: 'Kasun Silva', packageName: '12 sessions', sessionsLeft: 12, endDate: '2026-12-20' }
    ])
    // The membership ends on 31 Oct: no personal training after that, whatever the package says.
    at(31)
    expect(checkInOptions(db, nimal)).toHaveLength(1)
    vi.setSystemTime(new Date(2026, 10, 1, 10, 0))
    expect(checkInOptions(db, nimal)).toEqual([])
    expect(() => checkIn(db, nimal, 'DESK', new Date(), pt.id)).toThrow('can’t be used today')
  })

  it('uses a session, not twice for a double tap, and turns a gym check-in into the session', () => {
    const pt = createPtRegistration(db, sale())
    const first = checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    expect(first).toMatchObject({ repeat: false, session: { trainerName: 'Kasun Silva', sessionsLeft: 11 } })
    expect(checkIn(db, nimal, 'DOOR', new Date(), pt.id)).toMatchObject({ repeat: true, session: { sessionsLeft: 11 } })
    expect(getPtRegistration(db, pt.id)).toMatchObject({ used: 1, left: 11 })

    at(22)
    const gym = checkIn(db, nimal, 'DOOR')
    expect(gym.session).toBeNull()
    at(22, 10, 30)
    const session = checkIn(db, nimal, 'DESK', new Date(), pt.id)
    expect(session).toMatchObject({ visitId: gym.visitId, repeat: false, session: { sessionsLeft: 10 } })
    expect(getPtRegistration(db, pt.id).used).toBe(2)

    // Removing the visit gives the session back.
    deleteVisit(db, session.visitId!)
    expect(getPtRegistration(db, pt.id)).toMatchObject({ used: 1, left: 11 })
  })

  it('stops offering a package once its sessions are used up', () => {
    const pt = createPtRegistration(db, sale({ sessions: 2 }))
    checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    at(21)
    checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    at(22)
    expect(checkInOptions(db, nimal)).toEqual([])
    expect(getPtRegistration(db, pt.id)).toMatchObject({ used: 2, left: 0 })
  })

  it('lists sessions numbered within their package', () => {
    const pt = createPtRegistration(db, sale())
    checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    at(23)
    checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    expect(listPtSessions(db, { from: '2026-10-01', to: '2026-10-31' }).map((s) => [s.checkedInAt.slice(0, 10), s.number, s.sessions, s.trainerName])).toEqual([
      ['2026-10-23', 2, 12, 'Kasun Silva'],
      ['2026-10-20', 1, 12, 'Kasun Silva']
    ])
  })
})

describe('changing and removing a package', () => {
  it('can’t have fewer sessions than were had; moving it to the owner drops the commission', () => {
    const pt = createPtRegistration(db, sale())
    checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    at(21)
    checkIn(db, nimal, 'DOOR', new Date(), pt.id)
    const terms = { trainerId: kasun, sessions: 1, startDate: today, endDate: '2027-01-19', amount: 24000, commission: 6000 }
    expect(() => updatePtRegistration(db, pt.id, terms)).toThrow("They've already had 2 sessions")
    updatePtRegistration(db, pt.id, { ...terms, sessions: 10, trainerId: owner })
    expect(getPtRegistration(db, pt.id)).toMatchObject({ trainerName: 'Owner', commission: 0, endDate: '2027-01-19', left: 8 })
  })

  it('deletes only a mistake: nothing paid, no sessions', () => {
    const paid = createPtRegistration(db, sale({ payment: { amount: 100, paymentType: 'CASH' } }))
    expect(() => deletePtRegistration(db, paid.id)).toThrow('has payments')
    const used = createPtRegistration(db, sale())
    checkIn(db, nimal, 'DOOR', new Date(), used.id)
    expect(() => deletePtRegistration(db, used.id)).toThrow('They’ve had 1 session on this package')
    const empty = createPtRegistration(db, sale())
    deletePtRegistration(db, empty.id)
    expect(() => getPtRegistration(db, empty.id)).toThrow()
  })
})

describe('commission', () => {
  it('per trainer for packages starting in the month, with what has been paid and the sessions given', () => {
    const one = createPtRegistration(db, sale({ payment: { amount: 24000, paymentType: 'CASH' } }))
    createPtRegistration(db, sale({ amount: 12000, commission: 3000, sessions: 6 }))
    createPtRegistration(db, sale({ trainerId: owner, amount: 20000 }))
    createPtRegistration(db, sale({ startDate: '2026-11-02', endDate: '2027-01-01' }))
    checkIn(db, nimal, 'DOOR', new Date(), one.id)

    const report = commissionReport(db, '2026-10')
    expect(report.map((t) => [t.trainerName, t.packages.length, t.total, t.paid, t.commission, t.sessions])).toEqual([
      ['Owner', 1, 20000, 0, 0, 0],
      ['Kasun Silva', 2, 36000, 24000, 10200, 1]
    ])
    expect(commissionReport(db, '2026-11').map((t) => [t.trainerName, t.commission])).toEqual([['Kasun Silva', 7200]])
    expect(commissionReport(db, '2026-09')).toEqual([])
  })
})

describe('members', () => {
  it('shows their packages; merging keeps them; they can’t be deleted', () => {
    createPtRegistration(db, sale())
    expect(getMember(db, nimal).personalTraining).toEqual([expect.objectContaining({ trainerName: 'Kasun Silva' })])
    // Anyone with personal training has a membership too, so that's what stops it first.
    expect(() => deleteMembers(db, [nimal])).toThrow(/can't be deleted/)
    const keep = member('Nimal')
    mergeMembers(db, keep, [nimal])
    expect(getMember(db, keep).personalTraining).toHaveLength(1)
  })
})

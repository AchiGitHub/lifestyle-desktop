import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { members, payments, products, registrationMembers, registrations } from '../src/main/db/schema'
import { hasPassword, setPassword, verifyPassword } from '../src/main/services/auth'
import { AppError } from '../src/main/services/errors'
import {
  deleteMembers,
  findByMobile,
  getMember,
  listMembers,
  mergeMembers,
  possibleDuplicates,
  similarNames
} from '../src/main/services/members'
import { addPayment, deletePayment, listPayments } from '../src/main/services/payments'
import {
  deleteMembershipTypes,
  listDurations,
  listMembershipTypes,
  setMembershipTypeArchived
} from '../src/main/services/plans'
import { sellProduct } from '../src/main/services/products'
import {
  createRegistration,
  deleteRegistrations,
  expiredRegistrations,
  expiringRegistrations,
  getRegistration,
  setDismissed
} from '../src/main/services/registrations'
import { addDays, monthRange, todayIso } from '../src/shared/dates'
import { makeDb, memberData, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
const today = todayIso()
const rows = (table: typeof members | typeof registrations | typeof payments | typeof registrationMembers) =>
  db.select({ n: count() }).from(table).get()!.n

beforeEach(() => {
  db = makeDb()
})

describe('registrations', () => {
  it('creates a registration for an existing and a new member with a partial payment', () => {
    const typeId = seedPlan(db, { members: 2, price: 18000 })
    const existing = seedMember(db, { firstName: 'Kamal' })

    const reg = createRegistration(db, {
      membershipTypeId: typeId,
      startDate: today,
      endDate: addDays(today, 30),
      amount: 18000,
      members: [
        { kind: 'existing', memberId: existing },
        { kind: 'new', member: memberData({ firstName: 'Sunethra', gender: 'FEMALE' }) }
      ],
      payment: { amount: 10000, paymentType: 'CASH' }
    })

    expect(reg.paid).toBe(10000)
    expect(reg.balance).toBe(8000)
    expect(reg.name).toBe('Kamal Silva')
    expect(reg.members.map((m) => m.firstName).sort()).toEqual(['Kamal', 'Sunethra'])
    expect(rows(members)).toBe(2)

    addPayment(db, { registrationId: reg.id, amount: 8000, paymentType: 'ONLINE' })
    expect(getRegistration(db, reg.id).balance).toBe(0)
  })

  it('writes nothing when a step fails part-way', () => {
    const typeId = seedPlan(db, { members: 2 })
    expect(() =>
      createRegistration(db, {
        membershipTypeId: typeId,
        startDate: today,
        endDate: addDays(today, 30),
        amount: 10000,
        members: [
          { kind: 'new', member: memberData() },
          { kind: 'existing', memberId: randomUUID() }
        ],
        payment: { amount: 10000, paymentType: 'CASH' }
      })
    ).toThrow(AppError)
    expect(rows(members)).toBe(0)
    expect(rows(registrations)).toBe(0)
    expect(rows(payments)).toBe(0)
  })

  it('rejects archived plans and too many members', () => {
    const typeId = seedPlan(db, { members: 1 })
    const base = {
      membershipTypeId: typeId,
      startDate: today,
      endDate: addDays(today, 30),
      amount: 10000,
      payment: { amount: 0, paymentType: 'CASH' as const }
    }
    expect(() =>
      createRegistration(db, {
        ...base,
        members: [
          { kind: 'new', member: memberData() },
          { kind: 'new', member: memberData({ firstName: 'Two' }) }
        ]
      })
    ).toThrow(/for 1 member/)
    setMembershipTypeArchived(db, typeId, true)
    expect(() => createRegistration(db, { ...base, members: [{ kind: 'new', member: memberData() }] })).toThrow(
      /archived/
    )
  })

  it('blocks deleting a registration with payments, allows it without', () => {
    const typeId = seedPlan(db)
    const paid = createRegistration(db, {
      membershipTypeId: typeId,
      startDate: today,
      endDate: addDays(today, 30),
      amount: 10000,
      members: [{ kind: 'new', member: memberData() }],
      payment: { amount: 10000, paymentType: 'CASH' }
    })
    expect(() => deleteRegistrations(db, [paid.id])).toThrow(/Dismiss/)

    const unpaid = seedRegistration(db, typeId, [seedMember(db)], today, addDays(today, 30))
    deleteRegistrations(db, [unpaid])
    expect(db.select().from(registrations).where(eq(registrations.id, unpaid)).get()).toBeUndefined()
  })

  it('lists lapsed memberships but not members who renewed', () => {
    const typeId = seedPlan(db)
    const renewedMember = seedMember(db, { firstName: 'Renewed' })
    const lapsedMember = seedMember(db, { firstName: 'Lapsed' })
    const oldOfRenewed = seedRegistration(db, typeId, [renewedMember], addDays(today, -60), addDays(today, -30))
    seedRegistration(db, typeId, [renewedMember], addDays(today, -29), addDays(today, 30))
    const lapsed = seedRegistration(db, typeId, [lapsedMember], addDays(today, -60), addDays(today, -5))

    expect(expiredRegistrations(db).map((r) => r.id)).toEqual([lapsed])
    expect(getRegistration(db, oldOfRenewed).renewed).toBe(true)
    expect(getRegistration(db, lapsed).renewed).toBe(false)

    setDismissed(db, [lapsed], true)
    expect(expiredRegistrations(db)[0].dismissedAt).not.toBeNull()
  })

  it('finds registrations ending in a month', () => {
    const typeId = seedPlan(db)
    const id = seedRegistration(db, typeId, [seedMember(db)], '2026-01-10', '2026-02-10')
    seedRegistration(db, typeId, [seedMember(db)], '2026-01-10', '2026-03-10')
    expect(expiringRegistrations(db, monthRange('2026-02-01')).map((r) => r.id)).toEqual([id])
  })
})

describe('plans and members', () => {
  // Regression: correlated subqueries once compared against the wrong "id".
  it('lists each member with their latest end date and registration count', () => {
    const typeId = seedPlan(db)
    const a = seedMember(db, { firstName: 'Anoma' })
    const b = seedMember(db, { firstName: 'Bandara' })
    seedRegistration(db, typeId, [a], '2026-01-01', '2026-02-01')
    seedRegistration(db, typeId, [a], '2026-02-02', '2026-03-02')
    const list = listMembers(db)
    expect(list.find((m) => m.id === a)).toMatchObject({ lastEndDate: '2026-03-02', registrationCount: 2 })
    expect(list.find((m) => m.id === b)).toMatchObject({ lastEndDate: null, registrationCount: 0 })
  })

  it('counts plans per duration and registrations per plan', () => {
    const typeId = seedPlan(db)
    seedRegistration(db, typeId, [seedMember(db)], today, addDays(today, 30))
    seedPlan(db) // a second duration with its own plan
    expect(listDurations(db).map((d) => d.planCount)).toEqual([1, 1])
    expect(listMembershipTypes(db).find((t) => t.id === typeId)?.registrationCount).toBe(1)
  })

  it('blocks deleting a plan that has registrations', () => {
    const typeId = seedPlan(db)
    seedRegistration(db, typeId, [seedMember(db)], today, addDays(today, 30))
    expect(() => deleteMembershipTypes(db, [typeId])).toThrow(/Archive/)
  })

  it('blocks deleting a member who is on a registration', () => {
    const typeId = seedPlan(db)
    const memberId = seedMember(db)
    seedRegistration(db, typeId, [memberId], today, addDays(today, 30))
    expect(() => deleteMembers(db, [memberId])).toThrow(/merge/)
    const free = seedMember(db)
    deleteMembers(db, [free])
    expect(db.select().from(members).where(eq(members.id, free)).get()).toBeUndefined()
  })

  it('matches mobile numbers typed in different formats', () => {
    seedMember(db, { mobileNumber: '077 123 4567' })
    seedMember(db, { mobileNumber: '+94771234567' })
    seedMember(db, { mobileNumber: '0719999999' })
    expect(findByMobile(db, '0771234567')).toHaveLength(2)
    expect(possibleDuplicates(db)).toHaveLength(1)
  })

  it('merges duplicates: moves registrations, keeps payments, fills blanks', () => {
    const typeId = seedPlan(db)
    const keep = seedMember(db, { firstName: 'Ruwan', nic: null })
    const dup = seedMember(db, { firstName: 'Ruwan', nic: '951234567V' })
    const old = seedRegistration(db, typeId, [keep], addDays(today, -90), addDays(today, -60))
    const reg = createRegistration(db, {
      membershipTypeId: typeId,
      startDate: today,
      endDate: addDays(today, 30),
      amount: 10000,
      members: [{ kind: 'existing', memberId: dup }],
      payment: { amount: 10000, paymentType: 'CASH' }
    })

    mergeMembers(db, keep, [dup])

    const detail = getMember(db, keep)
    expect(detail.member.nic).toBe('951234567V')
    expect(detail.registrations.map((r) => r.id).sort()).toEqual([reg.id, old].sort())
    expect(detail.payments).toHaveLength(1)
    expect(db.select().from(members).where(eq(members.id, dup)).get()).toBeUndefined()
  })

  it('refuses to merge two people on the same registration', () => {
    const typeId = seedPlan(db, { members: 2 })
    const a = seedMember(db, { firstName: 'Ruwan' })
    const b = seedMember(db, { firstName: 'Ruwan' })
    seedRegistration(db, typeId, [a, b], today, addDays(today, 30))
    expect(() => mergeMembers(db, a, [b])).toThrow(/same registration/)
    expect(listMembers(db)).toHaveLength(2)
  })
})

describe('possible duplicates', () => {
  const phone = '0771234567'

  it('ignores couples and families on the same registration, even with one phone', () => {
    const typeId = seedPlan(db, { members: 2 })
    const primary = seedMember(db, { firstName: 'Kasun', lastName: 'Fernando', mobileNumber: phone })
    const partner = seedMember(db, { firstName: 'Kasun', lastName: 'Fernando', mobileNumber: phone })
    seedRegistration(db, typeId, [primary, partner], today, addDays(today, 30))
    expect(possibleDuplicates(db)).toEqual([])
  })

  it('ignores family members with different first names who share a phone', () => {
    const typeId = seedPlan(db)
    seedRegistration(db, typeId, [seedMember(db, { firstName: 'Kasuni', lastName: 'Fernando', mobileNumber: phone })], today, addDays(today, 30))
    seedRegistration(db, typeId, [seedMember(db, { firstName: 'Dilini', lastName: 'Fernando', mobileNumber: phone })], today, addDays(today, 30))
    expect(possibleDuplicates(db)).toEqual([])
  })

  it('finds the same person entered again with a misspelt name', () => {
    const typeId = seedPlan(db)
    const first = seedMember(db, { firstName: 'Chamara', lastName: 'Wickramasinghe', mobileNumber: phone })
    const again = seedMember(db, { firstName: 'Chamara', lastName: 'Wickremasinghe', mobileNumber: '+94 77 123 4567' })
    seedMember(db, { firstName: 'Nadee', lastName: 'Wickramasinghe', mobileNumber: phone }) // his wife
    seedRegistration(db, typeId, [first], addDays(today, -60), addDays(today, -30))
    seedRegistration(db, typeId, [again], today, addDays(today, 30))
    const groups = possibleDuplicates(db)
    expect(groups).toHaveLength(1)
    expect(groups[0].members.map((m) => m.id).sort()).toEqual([first, again].sort())
  })

  it('ignores records with different NICs', () => {
    seedMember(db, { firstName: 'Ruwan', mobileNumber: phone, nic: '851234567V' })
    seedMember(db, { firstName: 'Ruwan', mobileNumber: phone, nic: '199912345678' })
    expect(possibleDuplicates(db)).toEqual([])
  })

  it('compares names sensibly', () => {
    const n = (full: string) => {
      const [firstName, ...rest] = full.split(' ')
      return { firstName, lastName: rest.join(' ') }
    }
    expect(similarNames(n('Nadeesha Perera'), n('Nadeesh Perera'))).toBe(true)
    expect(similarNames(n('Dr Ruwan Silva'), n('Ruwan Silva'))).toBe(true)
    expect(similarNames(n('Silva Ruwan'), n('Ruwan Silva'))).toBe(true)
    expect(similarNames(n('Kasuni Fernando'), n('Dilini Fernando'))).toBe(false)
    expect(similarNames(n('A.B. Kumara'), n('C.D. Kumara'))).toBe(false)
    expect(similarNames(n('Amal Perera'), n('Kamal Perera'))).toBe(false)
  })
})

describe('store', () => {
  function seedProduct(quantity: number): string {
    const id = randomUUID()
    db.insert(products)
      .values({ id, name: 'Yeti Isotonic', productType: 'BEVERAGE', quantity, price: 245, sellingPrice: 350 })
      .run()
    return id
  }

  it('charges the selling price and reduces stock', () => {
    const id = seedProduct(10)
    sellProduct(db, { productId: id, quantity: 3, paymentType: 'CASH' })
    const product = db.select().from(products).where(eq(products.id, id)).get()!
    expect(product.quantity).toBe(7)
    expect(product.sold).toBe(3)
    const [sale] = listPayments(db, { from: today, to: today })
    expect(sale.amount).toBe(1050)
    expect(sale.category).toBe('BEVERAGE')
    expect(sale.description).toBe('Yeti Isotonic × 3')

    deletePayment(db, sale.id)
    expect(db.select().from(products).where(eq(products.id, id)).get()!.quantity).toBe(10)
  })

  it('refuses to sell more than is in stock', () => {
    const id = seedProduct(2)
    expect(() => sellProduct(db, { productId: id, quantity: 3, paymentType: 'CASH' })).toThrow(/Only 2/)
    expect(rows(payments)).toBe(0)
  })
})

describe('auth', () => {
  it('stores a hashed password and verifies it', () => {
    expect(hasPassword(db)).toBe(false)
    setPassword(db, 'front-desk')
    expect(hasPassword(db)).toBe(true)
    expect(verifyPassword(db, 'front-desk')).toBe(true)
    expect(verifyPassword(db, 'wrong')).toBe(false)
    expect(() => setPassword(db, '123')).toThrow()
  })
})

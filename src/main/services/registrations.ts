import { randomUUID } from 'node:crypto'
import { eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { NewRegistration, Registration, RegistrationMember } from '../../shared/api'
import { nowLocalIso, todayIso } from '../../shared/dates'
import {
  registrationCreateInput,
  registrationUpdateInput,
  type RegistrationCreateInput,
  type RegistrationUpdateInput
} from '../../shared/schemas'
import type { Db } from '../db/client'
import { members, membershipTypes, payments, registrationMembers, registrations } from '../db/schema'
import { joiningFeeAdvice } from '../../shared/joining'
import { AppError, nowUtc, plural } from './errors'
import { joiningFeeSettings, lastEndDate } from './joining'
import { nextReceiptNo } from './payments'

interface RegistrationRow {
  id: string
  name: string
  membershipTypeId: string
  membershipTypeName: string
  startDate: string
  endDate: string
  amount: number
  joiningFee: number
  dismissedAt: string | null
  paid: number
  renewed: number
  remindedAt: string | null
}

/** SQL on alias `r`: someone on the registration has one ending later, so it was renewed. */
export const wasRenewed = sql`exists(
  select 1 from registration_members rm
  join registration_members rm2 on rm2.member_id = rm.member_id
  join registrations r2 on r2.id = rm2.registration_id
  where rm.registration_id = r.id and r2.end_date > r.end_date
)`

/** SQL on alias `r`: someone on it had registered before, so it's a renewal rather than a new sign-up. */
export const isRenewal = sql`exists(
  select 1 from registration_members rm
  join registration_members rm2 on rm2.member_id = rm.member_id and rm2.registration_id <> rm.registration_id
  join registrations r2 on r2.id = rm2.registration_id
  where rm.registration_id = r.id and r2.start_date < r.start_date
)`

/** Loads registrations matching `where` (an SQL condition on alias `r`), newest first. */
export function loadRegistrations(db: Db, where?: SQL): Registration[] {
  const rows = db.all<RegistrationRow>(sql`
    select r.id, r.name, r.membership_type_id as membershipTypeId, mt.name as membershipTypeName,
      r.start_date as startDate, r.end_date as endDate, r.amount, r.dismissed_at as dismissedAt,
      coalesce((select sum(rmf.joining_fee) from registration_members rmf where rmf.registration_id = r.id), 0)
        as joiningFee,
      coalesce((select sum(p.amount) from payments p where p.registration_id = r.id), 0) as paid,
      ${wasRenewed} as renewed,
      (select max(rem.sent_at) from reminders rem
        where rem.registration_id = r.id and rem.kind <> 'BALANCE') as remindedAt
    from registrations r
    join membership_types mt on mt.id = r.membership_type_id
    ${where ? sql`where ${where}` : sql``}
    order by r.start_date desc, r.created_at desc`)

  const membersByRegistration = new Map<string, RegistrationMember[]>()
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 500) {
    const links = db
      .select({
        registrationId: registrationMembers.registrationId,
        id: members.id,
        firstName: members.firstName,
        lastName: members.lastName,
        mobileNumber: members.mobileNumber
      })
      .from(registrationMembers)
      .innerJoin(members, eq(members.id, registrationMembers.memberId))
      .where(inArray(registrationMembers.registrationId, ids.slice(i, i + 500)))
      .all()
    for (const { registrationId, ...member } of links) {
      const list = membersByRegistration.get(registrationId) ?? []
      list.push(member)
      membersByRegistration.set(registrationId, list)
    }
  }

  return rows.map((r) => ({
    ...r,
    renewed: Boolean(r.renewed),
    balance: Math.max(0, r.amount - r.paid),
    members: membersByRegistration.get(r.id) ?? []
  }))
}

export function listRegistrations(db: Db, filter: { status: 'active' | 'all' }): Registration[] {
  return loadRegistrations(db, filter.status === 'active' ? sql`r.end_date >= ${todayIso()}` : undefined)
}

export function getRegistration(db: Db, id: string): Registration {
  const [registration] = loadRegistrations(db, sql`r.id = ${id}`)
  if (!registration) throw new AppError('That registration no longer exists.')
  return registration
}

export function registrationsForMember(db: Db, memberId: string): Registration[] {
  return loadRegistrations(
    db,
    sql`r.id in (select registration_id from registration_members where member_id = ${memberId})`
  )
}

/** Registrations ending inside the range, whether or not they were renewed. */
export function expiringRegistrations(db: Db, range: { from: string; to: string }): Registration[] {
  return loadRegistrations(db, sql`r.end_date between ${range.from} and ${range.to}`)
}

/** Registrations starting inside the range. */
export function startingRegistrations(db: Db, range: { from: string; to: string }): Registration[] {
  return loadRegistrations(db, sql`r.start_date between ${range.from} and ${range.to}`)
}

/**
 * Lapsed memberships: registrations that have ended and are still the latest
 * registration for at least one of their members (so nobody renewed them).
 */
export function expiredRegistrations(db: Db): Registration[] {
  return loadRegistrations(
    db,
    sql`r.end_date < ${todayIso()} and r.id in (
      select rm.registration_id from registration_members rm
      join registrations r1 on r1.id = rm.registration_id
      where r1.end_date = (
        select max(r2.end_date) from registration_members rm2
        join registrations r2 on r2.id = rm2.registration_id
        where rm2.member_id = rm.member_id
      )
    )`
  )
}

export function createRegistration(db: Db, raw: RegistrationCreateInput): NewRegistration {
  const input = registrationCreateInput.parse(raw)
  const id = randomUUID()
  const paymentId = input.payment.amount > 0 ? randomUUID() : null

  db.transaction((tx) => {
    const type = tx.select().from(membershipTypes).where(eq(membershipTypes.id, input.membershipTypeId)).get()
    if (!type) throw new AppError('That plan no longer exists.')
    if (type.archived) throw new AppError(`"${type.name}" is archived. Choose a current plan.`)
    if (input.members.length > type.numberOfMembers) {
      throw new AppError(`"${type.name}" is for ${plural(type.numberOfMembers, 'member')}.`)
    }

    const { breakDays } = joiningFeeSettings(tx)
    const memberIds: string[] = []
    const names: string[] = []
    const fees: number[] = []
    for (const slot of input.members) {
      // Staff can tick or untick the fee; otherwise the usual rule decides.
      let due: boolean
      if (slot.kind === 'existing') {
        const existing = tx.select().from(members).where(eq(members.id, slot.memberId)).get()
        if (!existing) throw new AppError('One of the chosen members no longer exists.')
        due = slot.chargeJoiningFee ?? joiningFeeAdvice(lastEndDate(tx, existing.id), input.startDate, breakDays).due
        memberIds.push(existing.id)
        names.push(`${existing.firstName} ${existing.lastName}`.trim())
      } else {
        const memberId = randomUUID()
        tx.insert(members).values({ id: memberId, ...slot.member }).run()
        due = slot.chargeJoiningFee ?? true
        memberIds.push(memberId)
        names.push(`${slot.member.firstName} ${slot.member.lastName}`.trim())
      }
      fees.push(due ? type.joiningFee : 0)
    }

    tx.insert(registrations)
      .values({
        id,
        name: names[0],
        membershipTypeId: type.id,
        startDate: input.startDate,
        endDate: input.endDate,
        amount: input.amount + fees.reduce((s, f) => s + f, 0)
      })
      .run()
    tx.insert(registrationMembers)
      .values(memberIds.map((memberId, i) => ({ registrationId: id, memberId, joiningFee: fees[i] })))
      .run()

    if (paymentId) {
      tx.insert(payments)
        .values({
          id: paymentId,
          registrationId: id,
          amount: input.payment.amount,
          paymentType: input.payment.paymentType,
          category: 'MEMBERSHIP',
          paidAt: nowLocalIso(),
          receiptNo: nextReceiptNo(tx)
        })
        .run()
    }
  })

  return { ...getRegistration(db, id), paymentId }
}

export function updateRegistration(db: Db, id: string, raw: RegistrationUpdateInput): void {
  const input = registrationUpdateInput.parse(raw)
  const type = db.select().from(membershipTypes).where(eq(membershipTypes.id, input.membershipTypeId)).get()
  if (!type) throw new AppError('That plan no longer exists.')
  const { joiningFee } = getRegistration(db, id)
  if (input.amount < joiningFee) {
    throw new AppError(`The amount includes joining fees of Rs. ${joiningFee.toLocaleString('en-US')}, so it can't be less.`)
  }
  const result = db
    .update(registrations)
    .set({ ...input, updatedAt: nowUtc() })
    .where(eq(registrations.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That registration no longer exists.')
}

export function setDismissed(db: Db, ids: string[], dismissed: boolean): void {
  if (ids.length === 0) return
  db.update(registrations)
    .set({ dismissedAt: dismissed ? nowUtc() : null, updatedAt: nowUtc() })
    .where(inArray(registrations.id, ids))
    .run()
}

export function deleteRegistrations(db: Db, ids: string[]): void {
  if (ids.length === 0) return
  const withPayments = db
    .select({ id: payments.registrationId })
    .from(payments)
    .where(inArray(payments.registrationId, ids))
    .groupBy(payments.registrationId)
    .all()
  if (withPayments.length > 0) {
    throw new AppError(
      withPayments.length === 1 && ids.length === 1
        ? 'This registration has payments, so it can\'t be deleted. Use Dismiss to hide it from the lists.'
        : `${plural(withPayments.length, 'registration')} have payments and can't be deleted. Use Dismiss to hide them from the lists.`
    )
  }
  db.delete(registrations).where(inArray(registrations.id, ids)).run()
}

import { inArray, sql } from 'drizzle-orm'
import type { MemberOwed, OwedDebt } from '../../shared/api'
import { parseIsoDate, todayIso, toIsoDate } from '../../shared/dates'
import { whatsappNumber } from '../../shared/reminders'
import type { Db } from '../db/client'
import { members } from '../db/schema'
import { owedList as storeCreditOwed } from './credit'
import { loadRegistrations } from './registrations'
import { loadPtRegistrations } from './training'

// Amounts are stored as reals; anything under a cent is rounding.
const CENT = 0.005

const unpaid = (table: 'registration_id' | 'pt_registration_id', alias: 'r' | 'p') =>
  sql`${sql.raw(alias)}.amount - coalesce((select sum(pay.amount) from payments pay
    where pay.${sql.raw(table)} = ${sql.raw(alias)}.id), 0) > ${CENT}`

/** The same day a year earlier: balances that ended before it are "older". */
function yearBefore(today: string): string {
  const d = parseIsoDate(today)
  d.setFullYear(d.getFullYear() - 1)
  return toIsoDate(d)
}

const latest = (dates: Array<string | null | undefined>): string | null =>
  dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null)

/**
 * Everyone with money still to pay for a membership, personal training or
 * store items, most owed first (not counting balances that ended over a year
 * ago, which are included but marked `older`).
 */
export function whoOwes(db: Db, now = new Date()): MemberOwed[] {
  const cutoff = yearBefore(todayIso(now))
  const debts = new Map<string, OwedDebt[]>()
  const add = (memberId: string, debt: OwedDebt) => debts.set(memberId, [...(debts.get(memberId) ?? []), debt])

  for (const registration of loadRegistrations(db, unpaid('registration_id', 'r'))) {
    // A couple shares one balance: list it once, under whoever can be messaged about it.
    const payer = registration.members.find((m) => whatsappNumber(m.mobileNumber)) ?? registration.members[0]
    if (!payer) continue
    add(payer.id, {
      kind: 'MEMBERSHIP',
      registration,
      owed: registration.balance,
      since: registration.startDate,
      older: registration.endDate < cutoff
    })
  }
  for (const pt of loadPtRegistrations(db, unpaid('pt_registration_id', 'p'))) {
    add(pt.memberId, { kind: 'PERSONAL_TRAINING', pt, owed: pt.balance, since: pt.startDate, older: pt.endDate < cutoff })
  }
  for (const credit of storeCreditOwed(db)) {
    add(credit.memberId, {
      kind: 'STORE_CREDIT',
      credit,
      owed: credit.owed,
      since: credit.items[0]?.soldAt.slice(0, 10) ?? todayIso(now),
      older: false
    })
  }
  if (debts.size === 0) return []

  const ids = [...debts.keys()]
  const people = db
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, mobileNumber: members.mobileNumber })
    .from(members)
    .where(inArray(members.id, ids))
    .all()
  const total = (m: MemberOwed, older: boolean) =>
    m.debts.filter((d) => older || !d.older).reduce((sum, d) => sum + d.owed, 0)

  return people
    .map(({ id, ...person }) => {
      const list = debts.get(id)!.sort((a, b) => a.since.localeCompare(b.since))
      const registrationIds = list.flatMap((d) => (d.kind === 'MEMBERSHIP' ? [d.registration.id] : []))
      const ptIds = list.flatMap((d) => (d.kind === 'PERSONAL_TRAINING' ? [d.pt.id] : []))
      // SQLite takes an empty "in ()".
      const dates = db.get<{ paid: string | null; balance: string | null; credit: string | null }>(sql`
        select
          (select max(paid_at) from payments
            where registration_id in ${registrationIds} or pt_registration_id in ${ptIds}) as paid,
          (select max(sent_at) from reminders where kind = 'BALANCE' and registration_id in ${registrationIds}) as balance,
          (select max(sent_at) from credit_reminders where member_id = ${id}) as credit`)!
      const storeCredit = list.flatMap((d) => (d.kind === 'STORE_CREDIT' ? [d.credit] : []))[0]
      // A reminder from before any of this was owed was about something else.
      const reminded = latest([dates.balance, dates.credit])
      return {
        memberId: id,
        ...person,
        debts: list,
        remindedAt: reminded && reminded.slice(0, 10) >= list[0].since ? reminded : null,
        lastPaidAt: latest([dates.paid, storeCredit?.lastPaidAt])
      }
    })
    .sort((a, b) => total(b, false) - total(a, false) || total(b, true) - total(a, true))
}

/** What one member owes, as listed under Money owed; null if nothing. */
export function memberOwed(db: Db, memberId: string): MemberOwed | null {
  return whoOwes(db).find((m) => m.memberId === memberId) ?? null
}

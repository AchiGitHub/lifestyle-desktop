import { sql } from 'drizzle-orm'
import type { DashboardReport, MonthFigures, PeriodFigures } from '../../shared/api'
import { monthRange, shiftMonth, todayIso } from '../../shared/dates'
import { PAYMENT_TYPES, type PaymentType } from '../../shared/enums'
import { monthInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { isRenewal, wasRenewed } from './registrations'

/** Months the dashboard's trends cover, ending with the chosen one. */
export const DASHBOARD_MONTHS = 12

const money = (value: number): number => Math.round(value * 100) / 100

function periodFigures(db: Db, from: string, to: string): PeriodFigures {
  const takings = db.get<{ memberships: number; personalTraining: number; store: number }>(sql`
    select coalesce(sum(case when category = 'MEMBERSHIP' then amount end), 0) as memberships,
      coalesce(sum(case when category = 'PERSONAL_TRAINING' then amount end), 0) as personalTraining,
      coalesce(sum(case when category not in ('MEMBERSHIP', 'PERSONAL_TRAINING') then amount end), 0) as store
    from payments
    where substr(paid_at, 1, 10) between ${from} and ${to}`)!
  const signUps = db.get<{ total: number; renewals: number }>(sql`
    select count(*) as total, coalesce(sum(${isRenewal}), 0) as renewals
    from registrations r
    where r.start_date between ${from} and ${to}`)!
  return {
    income: money(takings.memberships + takings.personalTraining + takings.store),
    memberships: money(takings.memberships),
    personalTraining: money(takings.personalTraining),
    store: money(takings.store),
    newSignUps: signUps.total - signUps.renewals,
    renewals: signUps.renewals
  }
}

function monthFigures(db: Db, month: string, today: string): MonthFigures {
  const { from, to } = monthRange(`${month}-01`)
  const partial = month === today.slice(0, 7)
  const through = partial ? today : to
  const active = db.get<{ n: number }>(sql`
    select count(distinct rm.member_id) as n from registration_members rm
    join registrations r on r.id = rm.registration_id
    where r.start_date <= ${through} and r.end_date >= ${through}`)!
  const ending = db.get<{ n: number; renewed: number }>(sql`
    select count(*) as n, coalesce(sum(${wasRenewed}), 0) as renewed
    from registrations r
    where r.end_date between ${from} and ${to}`)!
  return {
    month,
    partial,
    through,
    ...periodFigures(db, from, through),
    activeMembers: active.n,
    ending: ending.n,
    renewed: ending.renewed
  }
}

/**
 * One month for the dashboard (a later month means this one): its figures,
 * the month before for comparison, and the 11 months before it for trends.
 */
export function dashboardReport(db: Db, raw: string): DashboardReport {
  const today = todayIso()
  const requested = monthInput.parse(raw)
  const month = requested > today.slice(0, 7) ? today.slice(0, 7) : requested

  const months = Array.from({ length: DASHBOARD_MONTHS }, (_, i) =>
    monthFigures(db, shiftMonth(month, i + 1 - DASHBOARD_MONTHS), today)
  )
  const chosen = months[months.length - 1]
  const { from, to } = monthRange(`${month}-01`)
  const through = chosen.through

  // A month in progress is compared with the same days of the month before.
  const before = monthRange(`${shiftMonth(month, -1)}-01`)
  const sameDay = `${before.from.slice(0, 8)}${today.slice(8)}`
  const beforeTo = chosen.partial && sameDay < before.to ? sameDay : before.to

  const byPaymentType = Object.fromEntries(PAYMENT_TYPES.map((t) => [t, 0])) as Record<PaymentType, number>
  const methods = db.all<{ method: PaymentType; total: number }>(sql`
    select payment_type as method, sum(amount) as total from payments
    where substr(paid_at, 1, 10) between ${from} and ${through}
    group by payment_type`)
  for (const m of methods) byPaymentType[m.method] = money(m.total)

  const joiningFees = db.get<{ n: number }>(sql`
    select coalesce(sum(rm.joining_fee), 0) as n from registration_members rm
    join registrations r on r.id = rm.registration_id
    where r.start_date between ${from} and ${through}`)!.n

  const toRenew = db.get<{ n: number }>(sql`
    select count(*) as n from registrations r
    where r.end_date between ${from} and ${to} and r.dismissed_at is null and not ${wasRenewed}`)!.n

  const byPlan = db.all<{ membershipTypeId: string; name: string; count: number; amount: number }>(sql`
    select mt.id as membershipTypeId, mt.name, count(*) as count, sum(r.amount) as amount
    from registrations r join membership_types mt on mt.id = r.membership_type_id
    where r.start_date between ${from} and ${through}
    group by mt.id
    order by count desc, mt.name`)

  return {
    months,
    previous: { from: before.from, to: beforeTo, ...periodFigures(db, before.from, beforeTo) },
    byPaymentType,
    joiningFees,
    toRenew,
    byPlan
  }
}

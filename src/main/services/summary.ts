import { sql } from 'drizzle-orm'
import type { DaySummary, MethodTotal } from '../../shared/api'
import { addDays } from '../../shared/dates'
import { PAYMENT_TYPES, type PaymentCategory, type PaymentType } from '../../shared/enums'
import { dateRangeInput, type DateRangeInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { isRenewal } from './registrations'

const money = (value: number): number => Math.round(value * 100) / 100

function emptyDay(date: string): DaySummary {
  return {
    date,
    byMethod: Object.fromEntries(PAYMENT_TYPES.map((t) => [t, { count: 0, total: 0 }])) as Record<PaymentType, MethodTotal>,
    total: 0,
    count: 0,
    memberships: 0,
    store: 0,
    newSignUps: 0,
    renewals: 0,
    checkIns: 0
  }
}

/**
 * Every day in the range, newest first: takings by method, sign-ups and
 * renewals entered that day, and check-ins. Days with nothing are included.
 */
export function daySummaries(db: Db, raw: DateRangeInput): DaySummary[] {
  const { from, to } = dateRangeInput.parse(raw)
  const days = new Map<string, DaySummary>()
  for (let d = to; d >= from; d = addDays(d, -1)) days.set(d, emptyDay(d))

  const payments = db.all<{ day: string; method: PaymentType; category: PaymentCategory; n: number; total: number }>(sql`
    select substr(paid_at, 1, 10) as day, payment_type as method, category, count(*) as n, sum(amount) as total
    from payments
    where substr(paid_at, 1, 10) between ${from} and ${to}
    group by day, method, category`)
  for (const p of payments) {
    const day = days.get(p.day)!
    day.byMethod[p.method].count += p.n
    day.byMethod[p.method].total = money(day.byMethod[p.method].total + p.total)
    day.count += p.n
    day.total = money(day.total + p.total)
    if (p.category === 'MEMBERSHIP') day.memberships = money(day.memberships + p.total)
    else day.store = money(day.store + p.total)
  }

  // Entered that day (created_at is UTC). A renewal if anyone on it had registered before.
  const registrations = db.all<{ day: string; renewal: number }>(sql`
    select date(r.created_at, 'localtime') as day, ${isRenewal} as renewal
    from registrations r
    where date(r.created_at, 'localtime') between ${from} and ${to}`)
  for (const r of registrations) {
    const day = days.get(r.day)!
    if (r.renewal) day.renewals++
    else day.newSignUps++
  }

  const visits = db.all<{ day: string; n: number }>(sql`
    select substr(checked_in_at, 1, 10) as day, count(*) as n
    from visits
    where substr(checked_in_at, 1, 10) between ${from} and ${to}
    group by day`)
  for (const v of visits) days.get(v.day)!.checkIns = v.n

  return [...days.values()]
}

export function daySummary(db: Db, date: string): DaySummary {
  return daySummaries(db, { from: date, to: date })[0]
}

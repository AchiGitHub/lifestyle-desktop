import { sql } from 'drizzle-orm'
import type { Birthday, CalendarDay } from '../../shared/api'
import { dateRangeInput, type DateRangeInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { listClassSessions } from './classes'
import { isRenewal, wasRenewed } from './registrations'
import { daySummaries } from './summary'
import { listPtDays } from './training'

/** Every day in the range, oldest first: its classes, and counts of what else happened or is due. */
export function calendarDays(db: Db, raw: DateRangeInput): CalendarDay[] {
  const range = dateRangeInput.parse(raw)
  const { from, to } = range
  const days = new Map<string, CalendarDay>()
  for (const d of daySummaries(db, range).reverse()) {
    days.set(d.date, {
      date: d.date,
      classes: [],
      ptDays: [],
      takings: d.total,
      checkIns: d.checkIns,
      newSignUps: 0,
      renewals: 0,
      due: 0,
      ptEnding: 0,
      birthdays: 0
    })
  }

  for (const c of listClassSessions(db, range)) days.get(c.date)!.classes.push(c)
  for (const d of listPtDays(db, range)) days.get(d.date)!.ptDays.push(d)

  // By start date, not the entry date By day uses, so a month adds up to the dashboard.
  const starts = db.all<{ day: string; renewal: number }>(sql`
    select r.start_date as day, ${isRenewal} as renewal
    from registrations r
    where r.start_date between ${from} and ${to}`)
  for (const s of starts) {
    const day = days.get(s.day)!
    if (s.renewal) day.renewals++
    else day.newSignUps++
  }

  const due = db.all<{ day: string; n: number }>(sql`
    select r.end_date as day, count(*) as n
    from registrations r
    where r.end_date between ${from} and ${to} and r.dismissed_at is null and not ${wasRenewed}
    group by day`)
  for (const d of due) days.get(d.day)!.due = d.n

  const ptEnding = db.all<{ day: string; n: number }>(sql`
    select p.end_date as day, count(*) as n
    from pt_registrations p
    where p.end_date between ${from} and ${to}
      and (select count(*) from visits v where v.pt_registration_id = p.id) < p.sessions
    group by day`)
  for (const p of ptEnding) days.get(p.day)!.ptEnding = p.n

  const birthdays = db.all<{ day: string; n: number }>(sql`
    select substr(dob, 6, 5) as day, count(*) as n
    from members
    where dob is not null
    group by day`)
  const byMonthAndDay = new Map(birthdays.map((b) => [b.day, b.n]))
  for (const day of days.values()) day.birthdays = byMonthAndDay.get(day.date.slice(5)) ?? 0

  return [...days.values()]
}

export function birthdaysOn(db: Db, date: string): Birthday[] {
  const { from } = dateRangeInput.parse({ from: date, to: date })
  return db
    .all<{ id: string; firstName: string; lastName: string; mobileNumber: string | null; dob: string }>(sql`
      select id, first_name as firstName, last_name as lastName, mobile_number as mobileNumber, dob
      from members
      where substr(dob, 6, 5) = ${from.slice(5)}
      order by first_name collate nocase, last_name collate nocase`)
    .map((m) => ({
      id: m.id,
      name: `${m.firstName} ${m.lastName}`.trim(),
      mobileNumber: m.mobileNumber,
      turns: Number(from.slice(0, 4)) - Number(m.dob.slice(0, 4))
    }))
}

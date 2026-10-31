import type { DurationType } from './enums'

/**
 * Calendar dates are stored as 'YYYY-MM-DD' in the gym's local time, and
 * payment times as local 'YYYY-MM-DDTHH:mm:ss'. The app runs on one PC in
 * Sri Lanka, so "local" is the PC's clock.
 */
export type IsoDate = string

const pad = (n: number): string => String(n).padStart(2, '0')

export function toIsoDate(d: Date): IsoDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now)
}

export function nowLocalIso(now: Date = new Date()): string {
  return `${toIsoDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/** Local midnight of an ISO date. */
export function parseIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function ymd(year: number, monthIndex: number, day: number): IsoDate {
  const d = new Date(Date.UTC(year, monthIndex, day))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Whole days from one date to another: 1 Oct → 12 Oct is 11. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const utc = (iso: IsoDate) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

export function addDays(start: IsoDate, days: number): IsoDate {
  const [y, m, d] = start.split('-').map(Number)
  return ymd(y, m - 1, d + days)
}

/**
 * Last day of a membership (it counts as a day of membership): the day before
 * the same date N days/months/years on. 1 Oct + 1 month ends 31 Oct, so a
 * renewal starting the next day follows straight on, with no day added each
 * time. A 1-day pass ends the day it starts. When that date doesn't exist
 * (31 Jan + 1 month: there's no 31 Feb), it ends on the last day of that month.
 */
export function computeEndDate(start: IsoDate, duration: number, type: DurationType): IsoDate {
  const [y, m, d] = start.split('-').map(Number)
  if (type === 'DAY') return ymd(y, m - 1, d + duration - 1)
  const total = m - 1 + (type === 'YEAR' ? duration * 12 : duration)
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const last = daysInMonth(year, month)
  // Day 0 of a month is the last day of the month before.
  return d > last ? ymd(year, month, last) : ymd(year, month, d - 1)
}

/** A 'YYYY-MM' month moved by n months: shiftMonth('2026-01', -1) is '2025-12'. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const i = y * 12 + m - 1 + n
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`
}

/** Sri Lanka's year of assessment containing a date: 1 April to 31 March. */
export function taxYear(iso: IsoDate): { from: IsoDate; to: IsoDate } {
  const [y, m] = iso.split('-').map(Number)
  const start = m >= 4 ? y : y - 1
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` }
}

export function monthRange(iso: IsoDate): { from: IsoDate; to: IsoDate } {
  const [y, m] = iso.split('-').map(Number)
  return { from: ymd(y, m - 1, 1), to: ymd(y, m - 1, daysInMonth(y, m - 1)) }
}

/** The dates on the chosen days of the week between two dates, earliest first. */
export function weeklyDates(from: IsoDate, to: IsoDate, weekdays: number[]): IsoDate[] {
  const dates: IsoDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (weekdays.includes(parseIsoDate(d).getDay())) dates.push(d)
  }
  return dates
}

/** Days since the Monday of that week. */
const daysIntoWeek = (iso: IsoDate): number => (parseIsoDate(iso).getDay() + 6) % 7

/** The days a calendar shows for a 'YYYY-MM' month: whole weeks, Monday to Sunday. */
export function monthGrid(month: string): IsoDate[] {
  const { from, to } = monthRange(`${month}-01`)
  const first = addDays(from, -daysIntoWeek(from))
  const last = addDays(to, 6 - daysIntoWeek(to))
  return Array.from({ length: daysBetween(first, last) + 1 }, (_, i) => addDays(first, i))
}

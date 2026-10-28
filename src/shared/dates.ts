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
 * End date of a membership: start + N days/months/years. Month and year
 * steps clamp to the last day of a shorter month (31 Jan + 1 month = 28 Feb),
 * which is what the old app's date picker did.
 */
export function computeEndDate(start: IsoDate, duration: number, type: DurationType): IsoDate {
  const [y, m, d] = start.split('-').map(Number)
  switch (type) {
    case 'DAY':
      return ymd(y, m - 1, d + duration)
    case 'MONTH': {
      const total = m - 1 + duration
      const year = y + Math.floor(total / 12)
      const month = ((total % 12) + 12) % 12
      return ymd(year, month, Math.min(d, daysInMonth(year, month)))
    }
    case 'YEAR': {
      const year = y + duration
      return ymd(year, m - 1, Math.min(d, daysInMonth(year, m - 1)))
    }
  }
}

/** A 'YYYY-MM' month moved by n months: shiftMonth('2026-01', -1) is '2025-12'. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const i = y * 12 + m - 1 + n
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`
}

export function monthRange(iso: IsoDate): { from: IsoDate; to: IsoDate } {
  const [y, m] = iso.split('-').map(Number)
  return { from: ymd(y, m - 1, 1), to: ymd(y, m - 1, daysInMonth(y, m - 1)) }
}

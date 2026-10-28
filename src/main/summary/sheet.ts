// The owner's daily summary sheet, built as CSV: Google Drive turns it into a
// Google Sheet on upload. Plain Node, so it can be tested.
import type { DaySummary } from '../../shared/api'
import { longDateTime } from '../../shared/format'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const HEADER = [
  'Day',
  'Total (Rs.)',
  'Cash',
  'Card',
  'Bank transfer',
  'Memberships',
  'Store',
  'New sign-ups',
  'Renewals',
  'Check-ins'
]

// Blank instead of 0 keeps quiet days easy to read on a phone.
const amount = (n: number): string => (n === 0 ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }))
const number = (n: number): string => (n === 0 ? '' : String(n))

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1].slice(0, 3)}`
}

function row(label: string, d: Omit<DaySummary, 'date' | 'count'>): string[] {
  return [
    label,
    d.total === 0 ? '0' : amount(d.total),
    amount(d.byMethod.CASH.total),
    amount(d.byMethod.CARD.total),
    amount(d.byMethod.ONLINE.total),
    amount(d.memberships),
    amount(d.store),
    number(d.newSignUps),
    number(d.renewals),
    number(d.checkIns)
  ]
}

function addUp(days: DaySummary[]): Omit<DaySummary, 'date' | 'count'> {
  const sum = (f: (d: DaySummary) => number): number => Math.round(days.reduce((s, d) => s + f(d), 0) * 100) / 100
  return {
    total: sum((d) => d.total),
    byMethod: {
      CASH: { count: sum((d) => d.byMethod.CASH.count), total: sum((d) => d.byMethod.CASH.total) },
      CARD: { count: sum((d) => d.byMethod.CARD.count), total: sum((d) => d.byMethod.CARD.total) },
      ONLINE: { count: sum((d) => d.byMethod.ONLINE.count), total: sum((d) => d.byMethod.ONLINE.total) }
    },
    memberships: sum((d) => d.memberships),
    store: sum((d) => d.store),
    newSignUps: sum((d) => d.newSignUps),
    renewals: sum((d) => d.renewals),
    checkIns: sum((d) => d.checkIns)
  }
}

/**
 * The table under the title: a header, then for each month (newest first) a
 * total row followed by its days. `days` is newest first, as daySummaries returns it.
 */
export function summaryRows(days: DaySummary[], today: string): string[][] {
  const rows = [HEADER]
  const months = new Map<string, DaySummary[]>()
  for (const d of days) {
    const key = d.date.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), d])
  }
  for (const [key, monthDays] of months) {
    const [y, m] = key.split('-').map(Number)
    const label = `${MONTHS[m - 1]} ${y} ${today.startsWith(key) ? 'so far' : 'total'}`
    rows.push([], row(label.toUpperCase(), addUp(monthDays)))
    for (const d of monthDays) rows.push(row(dayLabel(d.date), d))
  }
  return rows
}

/** The title rows above the table. `updatedAt` is local 'YYYY-MM-DDTHH:mm:ss'. */
export function titleRows(gymName: string, updatedAt: string): string[][] {
  return [
    [`${gymName}: daily summary`],
    [`Updated ${longDateTime(updatedAt)} by the Lifestyle app. It rewrites this sheet, so changes made here are lost.`],
    []
  ]
}

const cell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

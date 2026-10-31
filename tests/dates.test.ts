import { describe, expect, it } from 'vitest'
import { addDays, computeEndDate, monthGrid, monthRange, shiftMonth, weeklyDates } from '../src/shared/dates'

describe('computeEndDate', () => {
  it('ends the day before: a 1-day pass ends the day it starts', () => {
    expect(computeEndDate('2026-10-27', 1, 'DAY')).toBe('2026-10-27')
    expect(computeEndDate('2026-12-30', 5, 'DAY')).toBe('2027-01-03')
  })

  it('ends the day before the same date in a later month', () => {
    expect(computeEndDate('2026-10-01', 1, 'MONTH')).toBe('2026-10-31')
    expect(computeEndDate('2026-10-27', 1, 'MONTH')).toBe('2026-11-26')
    expect(computeEndDate('2026-11-15', 3, 'MONTH')).toBe('2027-02-14')
    expect(computeEndDate('2026-01-01', 12, 'MONTH')).toBe('2026-12-31')
    expect(computeEndDate('2026-03-01', 1, 'MONTH')).toBe('2026-03-31')
  })

  it('ends on the last day of a shorter month when the same date doesn’t exist', () => {
    expect(computeEndDate('2026-01-31', 1, 'MONTH')).toBe('2026-02-28')
    expect(computeEndDate('2024-01-31', 1, 'MONTH')).toBe('2024-02-29')
    expect(computeEndDate('2024-01-30', 1, 'MONTH')).toBe('2024-02-29')
    expect(computeEndDate('2024-01-29', 1, 'MONTH')).toBe('2024-02-28')
    expect(computeEndDate('2026-03-31', 1, 'MONTH')).toBe('2026-04-30')
    expect(computeEndDate('2026-08-31', 6, 'MONTH')).toBe('2027-02-28')
  })

  it('does years the same way, including from 29 February', () => {
    expect(computeEndDate('2026-10-27', 1, 'YEAR')).toBe('2027-10-26')
    expect(computeEndDate('2026-01-01', 1, 'YEAR')).toBe('2026-12-31')
    expect(computeEndDate('2024-02-29', 1, 'YEAR')).toBe('2025-02-28')
  })

  it('lets renewals follow on without drifting a day each time', () => {
    let start = '2026-10-01'
    const ends: string[] = []
    for (let i = 0; i < 4; i++) {
      const end = computeEndDate(start, 1, 'MONTH')
      ends.push(end)
      start = addDays(end, 1) // a renewal starts the day after
    }
    expect(ends).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31'])
  })
})

describe('helpers', () => {
  it('monthRange covers the whole month', () => {
    expect(monthRange('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2024-02-01')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })

  it('addDays crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('shiftMonth crosses years both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-10', -11)).toBe('2025-11')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
  })
})

describe('monthGrid', () => {
  it('covers whole weeks, Monday to Sunday', () => {
    const days = monthGrid('2026-11')
    expect(days[0]).toBe('2026-10-26')
    expect(days[days.length - 1]).toBe('2026-12-06')
    expect(days).toHaveLength(42)
  })

  it('adds nothing when the month starts on a Monday and ends on a Sunday', () => {
    const days = monthGrid('2027-02')
    expect(days[0]).toBe('2027-02-01')
    expect(days[days.length - 1]).toBe('2027-02-28')
    expect(days).toHaveLength(28)
  })
})

describe('weeklyDates', () => {
  it('finds the chosen days of the week between two dates', () => {
    expect(weeklyDates('2026-11-02', '2026-11-12', [2, 4])).toEqual(['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12'])
  })

  it('includes both ends, and crosses months', () => {
    expect(weeklyDates('2026-11-30', '2026-12-07', [1])).toEqual(['2026-11-30', '2026-12-07'])
  })

  it('finds nothing with no days chosen', () => {
    expect(weeklyDates('2026-11-02', '2026-11-12', [])).toEqual([])
  })
})

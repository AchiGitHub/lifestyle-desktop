import { describe, expect, it } from 'vitest'
import { addDays, computeEndDate, monthRange, shiftMonth } from '../src/shared/dates'

describe('computeEndDate', () => {
  it('adds days', () => {
    expect(computeEndDate('2026-10-27', 1, 'DAY')).toBe('2026-10-28')
    expect(computeEndDate('2026-12-30', 5, 'DAY')).toBe('2027-01-04')
  })

  it('adds months, rolling into the next year', () => {
    expect(computeEndDate('2026-10-27', 1, 'MONTH')).toBe('2026-11-27')
    expect(computeEndDate('2026-11-15', 3, 'MONTH')).toBe('2027-02-15')
    expect(computeEndDate('2026-01-10', 12, 'MONTH')).toBe('2027-01-10')
  })

  it('clamps to the end of a shorter month', () => {
    expect(computeEndDate('2026-01-31', 1, 'MONTH')).toBe('2026-02-28')
    expect(computeEndDate('2024-01-31', 1, 'MONTH')).toBe('2024-02-29')
    expect(computeEndDate('2026-08-31', 6, 'MONTH')).toBe('2027-02-28')
  })

  it('adds years, including from 29 February', () => {
    expect(computeEndDate('2026-10-27', 1, 'YEAR')).toBe('2027-10-27')
    expect(computeEndDate('2024-02-29', 1, 'YEAR')).toBe('2025-02-28')
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

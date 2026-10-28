import { daysBetween } from './dates'

export const DEFAULT_BREAK_DAYS = 10

export interface JoiningFeeAdvice {
  /** Whether the fee should be charged unless staff decide otherwise. */
  due: boolean
  /** Why, in a few words for the front desk. */
  reason: string
}

/**
 * The joining fee is for new members, and for members coming back after a
 * break of more than `breakDays` days without a membership.
 */
export function joiningFeeAdvice(lastEndDate: string | null, startDate: string, breakDays: number): JoiningFeeAdvice {
  if (!lastEndDate) return { due: true, reason: 'New member' }
  // Days with no membership between the old end date and the new start date.
  const gap = daysBetween(lastEndDate, startDate) - 1
  if (gap > breakDays) return { due: true, reason: `Back after a ${gap}-day break` }
  if (gap > 0) return { due: false, reason: `Renewing after ${gap} day${gap === 1 ? '' : 's'}` }
  return { due: false, reason: 'Renewing' }
}

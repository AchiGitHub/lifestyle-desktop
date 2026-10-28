import type { Registration } from '@shared/api'
import { fullName } from './format'

/** Matches member names, phone digits or the plan name. */
export function matchesRegistration(r: Registration, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  const qDigits = q.replace(/\D/g, '').replace(/^0/, '')
  return (
    r.name.toLowerCase().includes(q) ||
    r.membershipTypeName.toLowerCase().includes(q) ||
    r.members.some(
      (m) =>
        fullName(m).toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (m.mobileNumber ?? '').replace(/\D/g, '').includes(qDigits))
    )
  )
}

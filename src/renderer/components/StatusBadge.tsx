import { Badge } from '@mantine/core'
import type { Registration } from '@shared/api'
import { todayIso } from '@shared/dates'
import { daysFromToday, formatDate } from '../lib/format'

export type RegistrationState = 'upcoming' | 'active' | 'expiring' | 'expired' | 'renewed' | 'dismissed'

export function registrationState(r: Pick<Registration, 'startDate' | 'endDate' | 'renewed' | 'dismissedAt'>): RegistrationState {
  const today = todayIso()
  if (r.endDate < today) {
    if (r.renewed) return 'renewed'
    if (r.dismissedAt) return 'dismissed'
    return 'expired'
  }
  if (r.startDate > today) return 'upcoming'
  if (daysFromToday(r.endDate) <= 7 && !r.renewed) return 'expiring'
  return 'active'
}

export const REGISTRATION_LOOK: Record<RegistrationState, { color: string; label: string }> = {
  upcoming: { color: 'blue', label: 'Upcoming' },
  active: { color: 'teal', label: 'Active' },
  expiring: { color: 'orange', label: 'Ending soon' },
  expired: { color: 'red', label: 'Not renewed' },
  renewed: { color: 'gray', label: 'Renewed' },
  dismissed: { color: 'gray', label: 'Dismissed' }
}

export function RegistrationBadge({ registration }: { registration: Parameters<typeof registrationState>[0] }) {
  const look = REGISTRATION_LOOK[registrationState(registration)]
  return (
    <Badge color={look.color} variant="light">
      {look.label}
    </Badge>
  )
}

/** Member status from their latest registration end date. */
export function MemberBadge({ lastEndDate }: { lastEndDate: string | null }) {
  if (!lastEndDate) {
    return (
      <Badge color="gray" variant="light">
        Never registered
      </Badge>
    )
  }
  return lastEndDate >= todayIso() ? (
    <Badge color="teal" variant="light">
      Active to {formatDate(lastEndDate)}
    </Badge>
  ) : (
    <Badge color="red" variant="light">
      Ended {formatDate(lastEndDate)}
    </Badge>
  )
}

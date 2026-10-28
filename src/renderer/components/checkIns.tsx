import { Badge, Button, Group, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import type { CheckInResult } from '@shared/api'
import { VISIT_STATUS_LABELS, type VisitStatus } from '@shared/enums'
import { api, notifyError } from '../lib/api'
import { formatDate } from '../lib/format'

export const STATUS_COLOR: Record<VisitStatus, string> = { OK: 'teal', EXPIRED: 'red', OWES: 'orange', NO_PLAN: 'gray' }

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return (
    <Badge variant="light" color={STATUS_COLOR[status]}>
      {VISIT_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Why staff should talk to them, or null if all is well. */
export function checkInWarning(r: Pick<CheckInResult, 'status' | 'endDate'>): string | null {
  switch (r.status) {
    case 'EXPIRED':
      return `membership ended ${formatDate(r.endDate)}`
    case 'OWES':
      return 'has money owing'
    case 'NO_PLAN':
      return 'has no membership'
    default:
      return null
  }
}

/**
 * Tells staff someone at the door needs them. It stays until closed, so it
 * isn't missed while they're busy.
 */
export function showCheckInAlert(r: CheckInResult, openMember: (id: string) => void): void {
  const warning = checkInWarning(r)
  if (!warning || r.repeat) return
  const id = `checkin-${r.visitId}`
  notifications.show({
    id,
    color: STATUS_COLOR[r.status],
    autoClose: false,
    title: `${r.fullName} checked in`,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm">At the door: {warning}.</Text>
        <Button
          size="compact-xs"
          variant="light"
          onClick={() => {
            openMember(r.memberId)
            notifications.hide(id)
          }}
        >
          Open
        </Button>
      </Group>
    )
  })
}

/** Checks a member in from the desk and says how it went. */
export function useDeskCheckIn(): (memberId: string) => Promise<void> {
  const queryClient = useQueryClient()
  return async (memberId) => {
    try {
      const r = await api.visits.checkIn(memberId)
      const warning = checkInWarning(r)
      notifications.show({
        color: warning ? STATUS_COLOR[r.status] : 'teal',
        autoClose: warning ? 8000 : 2500,
        message: r.repeat
          ? `${r.fullName} was already checked in.`
          : `${r.fullName} checked in${warning ? `: ${warning}` : ''}.`
      })
      void queryClient.invalidateQueries()
    } catch (e) {
      notifyError(e)
    }
  }
}

import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import type { CheckInOption, CheckInResult } from '@shared/api'
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

/** "Kasun (5 sessions left)", or "Kasun (last session)". */
function sessionText(s: NonNullable<CheckInResult['session']>): string {
  return `${s.trainerName} (${s.sessionsLeft === 0 ? 'last session' : `${s.sessionsLeft} session${s.sessionsLeft === 1 ? '' : 's'} left`})`
}

/**
 * Tells staff someone at the door needs them. It stays until closed, so it
 * isn't missed while they're busy. A personal training session gets a short
 * notice, so the trainer can be told.
 */
export function showCheckInAlert(r: CheckInResult, openMember: (id: string) => void): void {
  if (r.session && !r.repeat) {
    notifications.show({
      color: 'pink',
      autoClose: 8000,
      message: `${r.fullName}: personal training with ${sessionText(r.session)}`
    })
  }
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

/** Gym, or a session on one of their personal training packages. */
function CheckInChoice({ options, onChoose }: { options: CheckInOption[]; onChoose: (ptRegistrationId: string | null) => void }) {
  return (
    <Stack gap="sm">
      <Button variant="default" size="md" onClick={() => onChoose(null)}>
        Gym workout
      </Button>
      {options.map((o) => (
        <Button key={o.ptRegistrationId} variant="light" color="pink" size="md" onClick={() => onChoose(o.ptRegistrationId)}>
          Personal training with {o.trainerName} · {o.sessionsLeft} left
        </Button>
      ))}
    </Stack>
  )
}

/** Checks a member in from the desk and says how it went; with personal training, asks what for first. */
export function useDeskCheckIn(): (memberId: string) => Promise<void> {
  const queryClient = useQueryClient()
  const record = async (memberId: string, ptRegistrationId: string | null) => {
    try {
      const r = await api.visits.checkIn(memberId, ptRegistrationId)
      const warning = checkInWarning(r)
      const what = r.session ? ` for personal training with ${sessionText(r.session)}` : ''
      notifications.show({
        color: warning ? STATUS_COLOR[r.status] : r.session ? 'pink' : 'teal',
        autoClose: warning || r.session ? 8000 : 2500,
        message: r.repeat
          ? `${r.fullName} was already checked in${what}.`
          : `${r.fullName} checked in${what}${warning ? `: ${warning}` : ''}.`
      })
      void queryClient.invalidateQueries()
    } catch (e) {
      notifyError(e)
    }
  }
  return async (memberId) => {
    try {
      const options = await api.visits.options(memberId)
      if (options.length === 0) return await record(memberId, null)
      const id = modals.open({
        title: 'What are they here for?',
        children: (
          <CheckInChoice
            options={options}
            onChoose={(pt) => {
              modals.close(id)
              void record(memberId, pt)
            }}
          />
        )
      })
    } catch (e) {
      notifyError(e)
    }
  }
}

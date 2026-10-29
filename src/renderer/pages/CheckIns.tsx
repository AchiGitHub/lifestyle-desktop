import { ActionIcon, Badge, Group, Paper, SimpleGrid, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import type { Visit } from '@shared/api'
import { todayIso } from '@shared/dates'
import { VISIT_SOURCE_LABELS } from '@shared/enums'
import { AppTable } from '../components/AppTable'
import { useDeskCheckIn, VisitStatusBadge } from '../components/checkIns'
import { useMemberDrawer } from '../components/MemberDrawer'
import { MemberSearch } from '../components/MemberSearch'
import { PageHeader } from '../components/PageHeader'
import { api, useAction } from '../lib/api'
import { formatDate } from '../lib/format'

function Count({ label, value }: { label: string; value: number }) {
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fz={22} fw={700}>
        {value}
      </Text>
    </Paper>
  )
}

export function CheckIns() {
  const [date, setDate] = useState(todayIso())
  const { data = [], isPending } = useQuery({
    queryKey: ['visits', date],
    queryFn: () => api.visits.list({ from: date, to: date }),
    // Door check-ins also refresh this when they arrive; this is a fallback.
    refetchInterval: 30_000
  })
  const { openMember } = useMemberDrawer()
  const checkIn = useDeskCheckIn()
  const remove = useAction((id: string) => api.visits.delete(id), { success: 'Check-in removed' })

  return (
    <>
      <PageHeader
        title="Check-ins"
        description="Who came in, from the door tablet or the front desk."
        actions={
          <DatePickerInput
            value={date}
            onChange={(d) => d && setDate(d)}
            maxDate={todayIso()}
            valueFormat="ddd D MMM YYYY"
            w={200}
          />
        }
      />
      <Group mb="md" justify="space-between" align="flex-end">
        <MemberSearch placeholder="Check in a member at the desk…" width={360} onPick={(id) => void checkIn(id)} />
      </Group>
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
        <Count label={date === todayIso() ? 'Checked in today' : `Checked in ${formatDate(date)}`} value={data.length} />
        <Count label="Needed the desk" value={data.filter((v) => v.status !== 'OK').length} />
        <Count label="Personal training" value={data.filter((v) => v.ptRegistrationId).length} />
      </SimpleGrid>
      <AppTable<Visit>
        records={data}
        fetching={isPending}
        sort={{ columnAccessor: 'checkedInAt', direction: 'desc' }}
        emptyText="No check-ins on this day"
        columns={[
          {
            accessor: 'checkedInAt',
            title: 'Time',
            sortable: true,
            render: (v) => dayjs(v.checkedInAt).format('h:mm A')
          },
          {
            accessor: 'memberName',
            title: 'Member',
            sortable: true,
            render: (v) => (
              <button className="link-button" onClick={() => openMember(v.memberId)}>
                {v.memberName}
              </button>
            )
          },
          { accessor: 'status', title: 'Status', render: (v) => <VisitStatusBadge status={v.status} /> },
          {
            accessor: 'trainerName',
            title: 'For',
            render: (v) =>
              v.trainerName ? (
                <Badge variant="light" color="pink">
                  PT · {v.trainerName}
                </Badge>
              ) : (
                <Text size="sm" c="dimmed">
                  Gym
                </Text>
              )
          },
          { accessor: 'source', title: 'Where', render: (v) => VISIT_SOURCE_LABELS[v.source] },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            width: 60,
            render: (v) => (
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Remove check-in"
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Remove this check-in?',
                    children: (
                      <Text size="sm">
                        {v.memberName} at {dayjs(v.checkedInAt).format('h:mm A')}. Use this for a wrong tap at the
                        door.{v.trainerName && ' The personal training session is given back.'}
                      </Text>
                    ),
                    labels: { confirm: 'Remove', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => remove.mutate([v.id])
                  })
                }
              >
                <IconTrash size={16} />
              </ActionIcon>
            )
          }
        ]}
      />
    </>
  )
}

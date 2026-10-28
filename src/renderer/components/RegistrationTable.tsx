import { Stack, Text } from '@mantine/core'
import type { DataTableColumn } from 'mantine-datatable'
import type { ReactNode } from 'react'
import type { Registration } from '@shared/api'
import { formatDate, fullName, lkr, relativeDays } from '../lib/format'
import { AppTable } from './AppTable'
import { useMemberDrawer } from './MemberDrawer'
import { RegistrationBadge } from './StatusBadge'

export function MemberNames({ registration }: { registration: Registration }) {
  const { openMember } = useMemberDrawer()
  if (registration.members.length === 0) {
    return <Text size="sm">{registration.name}</Text>
  }
  return (
    <Stack gap={0}>
      <span>
        {registration.members.map((m, i) => (
          <span key={m.id}>
            {i > 0 && ', '}
            <button className="link-button" onClick={() => openMember(m.id)}>
              {fullName(m)}
            </button>
          </span>
        ))}
      </span>
      <Text size="xs" c="dimmed">
        {registration.members
          .map((m) => m.mobileNumber)
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Stack>
  )
}

export function RegistrationTable({
  records,
  fetching,
  selected,
  onSelectedChange,
  showMoney = true,
  showRelativeEnd = false,
  defaultSort = 'startDate',
  sortDirection = 'desc',
  actions,
  emptyText
}: {
  records: Registration[]
  fetching?: boolean
  selected?: Registration[]
  onSelectedChange?: (r: Registration[]) => void
  showMoney?: boolean
  showRelativeEnd?: boolean
  defaultSort?: 'startDate' | 'endDate'
  sortDirection?: 'asc' | 'desc'
  actions?: (r: Registration) => ReactNode
  emptyText?: string
}) {
  const columns: DataTableColumn<Registration>[] = [
    { accessor: 'members', title: 'Member(s)', sortable: true, render: (r) => <MemberNames registration={r} /> },
    { accessor: 'membershipTypeName', title: 'Plan', sortable: true },
    { accessor: 'startDate', title: 'Start', sortable: true, render: (r) => formatDate(r.startDate) },
    {
      accessor: 'endDate',
      title: 'End',
      sortable: true,
      render: (r) =>
        showRelativeEnd ? (
          <Stack gap={0}>
            <Text size="sm">{formatDate(r.endDate)}</Text>
            <Text size="xs" c="dimmed">
              {relativeDays(r.endDate)}
            </Text>
          </Stack>
        ) : (
          formatDate(r.endDate)
        )
    },
    ...(showMoney
      ? ([
          { accessor: 'amount', title: 'Amount', sortable: true, textAlign: 'right', render: (r) => lkr(r.amount) },
          {
            accessor: 'balance',
            title: 'Balance',
            sortable: true,
            textAlign: 'right',
            render: (r) =>
              r.balance > 0 ? (
                <Text size="sm" c="red" fw={600}>
                  {lkr(r.balance)}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  Paid
                </Text>
              )
          }
        ] satisfies DataTableColumn<Registration>[])
      : []),
    { accessor: 'status', title: 'Status', width: 135, render: (r) => <RegistrationBadge registration={r} /> },
    ...(actions
      ? ([{ accessor: 'actions', title: '', textAlign: 'right', render: actions }] satisfies DataTableColumn<Registration>[])
      : [])
  ]

  return (
    <AppTable<Registration>
      records={records}
      fetching={fetching}
      columns={columns}
      selected={selected}
      onSelectedChange={onSelectedChange}
      sort={{ columnAccessor: defaultSort, direction: sortDirection }}
      sortValues={{ members: (r) => (r.members[0] ? fullName(r.members[0]) : r.name).toLowerCase() }}
      emptyText={emptyText}
    />
  )
}

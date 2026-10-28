import { Badge, Button, Group, SegmentedControl, Text, TextInput } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconSearch, IconTrash, IconUserPlus, IconUsersGroup } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberListItem } from '@shared/api'
import { todayIso } from '@shared/dates'
import { GENDER_LABELS } from '@shared/enums'
import { AppTable } from '../components/AppTable'
import { useMemberDrawer } from '../components/MemberDrawer'
import { MemberFormModal } from '../components/MemberFormModal'
import { PageHeader } from '../components/PageHeader'
import { MemberBadge } from '../components/StatusBadge'
import { api, useAction } from '../lib/api'
import { fullName } from '../lib/format'
import { useMembers } from '../lib/queries'

type Filter = 'all' | 'active' | 'inactive'

export function Members() {
  const navigate = useNavigate()
  const { openMember } = useMemberDrawer()
  const { data: members = [], isPending } = useMembers()
  const duplicates = useQuery({ queryKey: ['duplicates'], queryFn: () => api.members.possibleDuplicates() })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<MemberListItem[]>([])
  const [adding, setAdding] = useState(false)
  const remove = useAction((ids: string[]) => api.members.delete(ids), {
    success: 'Deleted',
    errorTitle: 'Couldn’t delete'
  })

  const records = useMemo(() => {
    const today = todayIso()
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '').replace(/^0/, '')
    return members.filter((m) => {
      const active = m.lastEndDate !== null && m.lastEndDate >= today
      if (filter === 'active' && !active) return false
      if (filter === 'inactive' && active) return false
      if (!q) return true
      return (
        fullName(m).toLowerCase().includes(q) ||
        (m.nic ?? '').toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (m.mobileNumber ?? '').replace(/\D/g, '').includes(qDigits))
      )
    })
  }, [members, search, filter])

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: `Delete ${selected.length} member${selected.length === 1 ? '' : 's'}?`,
      children: (
        <Text size="sm">
          Only members who aren’t on any registration can be deleted. To combine duplicate records, use Possible
          duplicates instead.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate([selected.map((m) => m.id)], { onSuccess: () => setSelected([]) })
    })

  const dupCount = duplicates.data?.length ?? 0

  return (
    <>
      <PageHeader
        title="Members"
        description={`${members.length.toLocaleString()} members`}
        actions={
          <>
            <Button
              variant="default"
              leftSection={<IconUsersGroup size={16} />}
              rightSection={dupCount > 0 ? <Badge color="orange">{dupCount}</Badge> : undefined}
              onClick={() => navigate('/members/duplicates')}
            >
              Possible duplicates
            </Button>
            <Button leftSection={<IconUserPlus size={16} />} onClick={() => setAdding(true)}>
              Add member
            </Button>
          </>
        }
      />

      <Group mb="md" justify="space-between">
        <Group>
          <TextInput
            w={320}
            placeholder="Search name, phone or NIC"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            data={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Not active' }
            ]}
          />
        </Group>
        {selected.length > 0 && (
          <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={confirmDelete}>
            Delete {selected.length}
          </Button>
        )}
      </Group>

      <AppTable<MemberListItem>
        records={records}
        fetching={isPending}
        selected={selected}
        onSelectedChange={setSelected}
        sort={{ columnAccessor: 'name', direction: 'asc' }}
        sortValues={{ name: (m) => fullName(m).toLowerCase(), status: (m) => m.lastEndDate ?? '' }}
        emptyText={search ? 'No member matches that search' : 'No members yet'}
        columns={[
          {
            accessor: 'name',
            title: 'Name',
            sortable: true,
            render: (m) => (
              <button className="link-button" onClick={() => openMember(m.id)}>
                {fullName(m)}
              </button>
            )
          },
          { accessor: 'mobileNumber', title: 'Mobile' },
          { accessor: 'nic', title: 'NIC' },
          { accessor: 'gender', title: 'Gender', render: (m) => GENDER_LABELS[m.gender] },
          { accessor: 'occupation', title: 'Occupation' },
          { accessor: 'status', title: 'Status', sortable: true, render: (m) => <MemberBadge lastEndDate={m.lastEndDate} /> },
          { accessor: 'registrationCount', title: 'Registrations', sortable: true, textAlign: 'right' }
        ]}
      />

      <MemberFormModal opened={adding} onClose={() => setAdding(false)} onOpenExisting={(m) => openMember(m.id)} />
    </>
  )
}

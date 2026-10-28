import { Alert, Button, Center, Group, Loader, Paper, Radio, Stack, Table, Text, TextInput } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconArrowLeft, IconInfoCircle, IconSearch } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DuplicateGroup, MemberListItem } from '@shared/api'
import { useMemberDrawer } from '../components/MemberDrawer'
import { PageHeader } from '../components/PageHeader'
import { MemberBadge } from '../components/StatusBadge'
import { api, useAction } from '../lib/api'
import { formatDate, fullName } from '../lib/format'

/** Default pick: the record with the most history, then the most recent one. */
function suggestedKeep(members: MemberListItem[]): string {
  return [...members].sort(
    (a, b) =>
      b.registrationCount - a.registrationCount ||
      (b.lastEndDate ?? '').localeCompare(a.lastEndDate ?? '') ||
      b.createdAt.localeCompare(a.createdAt)
  )[0].id
}

function GroupCard({ group }: { group: DuplicateGroup }) {
  const { openMember } = useMemberDrawer()
  const [keep, setKeep] = useState(() => suggestedKeep(group.members))
  const [skipped, setSkipped] = useState<string[]>([])
  const merge = useAction((keepId: string, ids: string[]) => api.members.merge(keepId, ids), {
    success: 'Members merged'
  })
  const toMerge = group.members.filter((m) => m.id !== keep && !skipped.includes(m.id))
  const kept = group.members.find((m) => m.id === keep)!

  const confirm = () =>
    modals.openConfirmModal({
      title: 'Merge these records?',
      children: (
        <Text size="sm">
          {toMerge.length} record{toMerge.length === 1 ? '' : 's'} will be merged into <b>{fullName(kept)}</b>. Their
          registrations and payments move across, and details {fullName(kept)} is missing are copied over. This
          can’t be undone.
        </Text>
      ),
      labels: { confirm: 'Merge', cancel: 'Cancel' },
      onConfirm: () => merge.mutate([keep, toMerge.map((m) => m.id)])
    })

  return (
    <Paper p="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Mobile {group.mobileNumber}</Text>
        <Button size="xs" disabled={toMerge.length === 0} loading={merge.isPending} onClick={confirm}>
          Merge {toMerge.length + 1} records
        </Button>
      </Group>
      <Table verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={60}>Keep</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>NIC</Table.Th>
            <Table.Th>Date of birth</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th ta="right">Registrations</Table.Th>
            <Table.Th w={110} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {group.members.map((m) => {
            const isSkipped = skipped.includes(m.id)
            return (
              <Table.Tr key={m.id} opacity={isSkipped ? 0.45 : 1}>
                <Table.Td>
                  <Radio checked={keep === m.id} onChange={() => setKeep(m.id)} aria-label="Keep this record" />
                </Table.Td>
                <Table.Td>
                  <button className="link-button" onClick={() => openMember(m.id)}>
                    {fullName(m)}
                  </button>
                </Table.Td>
                <Table.Td>{m.nic ?? '—'}</Table.Td>
                <Table.Td>{formatDate(m.dob)}</Table.Td>
                <Table.Td>
                  <MemberBadge lastEndDate={m.lastEndDate} />
                </Table.Td>
                <Table.Td ta="right">{m.registrationCount}</Table.Td>
                <Table.Td ta="right">
                  {m.id !== keep && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      onClick={() =>
                        setSkipped((s) => (isSkipped ? s.filter((x) => x !== m.id) : [...s, m.id]))
                      }
                    >
                      {isSkipped ? 'Include' : 'Different person'}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}

export function Duplicates() {
  const navigate = useNavigate()
  const { data = [], isPending } = useQuery({ queryKey: ['duplicates'], queryFn: () => api.members.possibleDuplicates() })
  const [search, setSearch] = useState('')
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? data.filter((g) => g.members.some((m) => fullName(m).toLowerCase().includes(q))) : data
  }, [data, search])

  return (
    <>
      <PageHeader
        title="Possible duplicates"
        description="Same mobile number and a similar name"
        actions={
          <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate('/members')}>
            Members
          </Button>
        }
      />
      <Alert icon={<IconInfoCircle />} mb="md" variant="light">
        The old app created a new member record every time someone re-registered. These records share a phone
        number and have similar names. People on the same registration (couple and family plans) and people with
        different first names are never listed. Pick the record to keep, mark anyone who’s really someone else as
        “Different person”, then merge.
      </Alert>
      <TextInput
        w={320}
        mb="md"
        placeholder="Search by name"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {isPending ? (
        <Center h={200}>
          <Loader />
        </Center>
      ) : groups.length === 0 ? (
        <Text c="dimmed">No possible duplicates.</Text>
      ) : (
        <Stack>
          {groups.map((g) => (
            <GroupCard key={g.members.map((m) => m.id).join()} group={g} />
          ))}
        </Stack>
      )}
    </>
  )
}

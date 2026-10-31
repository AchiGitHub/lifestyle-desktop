import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { IconArchive, IconArchiveOff, IconEdit, IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PtPackage, PtRegistration, PtSession } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import { DURATION_TYPES, DURATION_TYPE_LABELS, durationLabel } from '@shared/enums'
import { ptPackageInput, type PtPackageInput } from '@shared/schemas'
import { AppTable } from '../components/AppTable'
import { useMemberDrawer } from '../components/MemberDrawer'
import { PageHeader } from '../components/PageHeader'
import { PtActions, PtSellModal, PtStateBadge, ptState, type PtStart, type PtState } from '../components/training'
import { api, useAction } from '../lib/api'
import { formatDate, formatDateTime, lkr, relativeDays } from '../lib/format'
import { usePtPackages, useTrainers } from '../lib/queries'

type Show = 'current' | 'USED_UP' | 'EXPIRED' | 'all'
const SHOWS: { value: Show; label: string }[] = [
  { value: 'current', label: 'Active' },
  { value: 'USED_UP', label: 'Used up' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'all', label: 'All' }
]
const shown = (show: Show, state: PtState): boolean =>
  show === 'all' || (show === 'current' ? state === 'ACTIVE' || state === 'NOT_STARTED' : state === show)

const nowrap = { whiteSpace: 'nowrap' } as const

function MemberLink({ id, name }: { id: string; name: string }) {
  const { openMember } = useMemberDrawer()
  return (
    <Anchor component="button" size="sm" ta="left" onClick={() => openMember(id)}>
      {name}
    </Anchor>
  )
}

function Clients() {
  const { data = [], isPending } = useQuery({ queryKey: ['personalTraining'], queryFn: () => api.personalTraining.list() })
  const { data: trainers = [] } = useTrainers()
  const { data: types = [] } = usePtPackages()
  const [show, setShow] = useState<Show>('current')
  const [trainerId, setTrainerId] = useState<string | null>(null)
  const rows = data.filter((p) => shown(show, ptState(p)) && (!trainerId || p.trainerId === trainerId))
  return (
    <Stack>
      {(trainers.length === 0 || types.length === 0) && (
        <Alert color="blue" icon={<IconInfoCircle />}>
          To start, add the trainers in{' '}
          <Anchor component={Link} to="/settings" size="sm">
            Settings → Personal trainers
          </Anchor>{' '}
          and the packages you sell on the <b>Session types</b> tab.
        </Alert>
      )}
      <Group>
        <SegmentedControl value={show} onChange={(v) => setShow(v as Show)} data={SHOWS} />
        <Select
          placeholder="All trainers"
          data={trainers.map((t) => ({ value: t.id, label: t.name }))}
          value={trainerId}
          onChange={setTrainerId}
          clearable
          w={200}
        />
      </Group>
      <AppTable<PtRegistration>
        records={rows}
        fetching={isPending}
        sort={{ columnAccessor: 'endDate', direction: 'asc' }}
        sortValues={{ sessions: (p) => p.left }}
        emptyText={show === 'current' ? 'No one has personal training running' : 'Nothing to show'}
        columns={[
          {
            accessor: 'memberName',
            title: 'Member',
            sortable: true,
            render: (p) => (
              <div>
                <MemberLink id={p.memberId} name={p.memberName} />
                <Text size="xs" c="dimmed">
                  {p.mobileNumber ?? ''}
                </Text>
              </div>
            )
          },
          { accessor: 'trainerName', title: 'Trainer', sortable: true },
          { accessor: 'packageName', title: 'Session type', sortable: true },
          {
            accessor: 'sessions',
            title: 'Sessions',
            sortable: true,
            render: (p) => (
              <div>
                <Text size="sm" fw={600} style={nowrap}>
                  {p.left} of {p.sessions} left
                </Text>
                <Text size="xs" c="dimmed" style={nowrap}>
                  {p.lastSessionAt ? `Last ${formatDate(p.lastSessionAt)}` : 'None yet'}
                </Text>
                {p.nextDay && p.left > 0 && (
                  <Text size="xs" c="dimmed" style={nowrap}>
                    Next {formatDate(p.nextDay)}
                  </Text>
                )}
              </div>
            )
          },
          {
            accessor: 'endDate',
            title: 'Use by',
            sortable: true,
            render: (p) => (
              <div>
                <Text size="sm" style={nowrap}>
                  {formatDate(p.endDate)}
                </Text>
                <Text size="xs" c="dimmed">
                  {relativeDays(p.endDate)}
                </Text>
              </div>
            )
          },
          {
            accessor: 'balance',
            title: 'Paid',
            sortable: true,
            textAlign: 'right',
            render: (p) => (
              <div>
                <Text size="sm" style={nowrap}>
                  {lkr(p.paid)} of {lkr(p.amount)}
                </Text>
                {p.balance > 0 && (
                  <Text size="xs" c="var(--app-red-text)" fw={600} style={nowrap}>
                    owes {lkr(p.balance)}
                  </Text>
                )}
              </div>
            )
          },
          { accessor: 'state', title: '', render: (p) => <PtStateBadge pt={p} /> },
          { accessor: 'actions', title: '', textAlign: 'right', width: 50, render: (p) => <PtActions pt={p} /> }
        ]}
      />
    </Stack>
  )
}

function Sessions() {
  const [month, setMonth] = useState(todayIso())
  const range = monthRange(month)
  const { data = [], isPending } = useQuery({
    queryKey: ['ptSessions', range.from, range.to],
    queryFn: () => api.personalTraining.sessions(range)
  })
  const byTrainer = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of data) counts.set(s.trainerName, (counts.get(s.trainerName) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [data])
  return (
    <Stack>
      <Group justify="space-between">
        <MonthPickerInput value={month} onChange={(v) => v && setMonth(v)} valueFormat="MMMM YYYY" w={200} />
        <Text fw={600}>{data.length} sessions</Text>
      </Group>
      {byTrainer.length > 0 && (
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          {byTrainer.map(([name, n]) => (
            <Paper key={name} p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                {name}
              </Text>
              <Text fz={22} fw={700}>
                {n} session{n === 1 ? '' : 's'}
              </Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}
      <AppTable<PtSession>
        records={data}
        fetching={isPending}
        sort={{ columnAccessor: 'checkedInAt', direction: 'desc' }}
        emptyText="No personal training sessions this month"
        columns={[
          { accessor: 'checkedInAt', title: 'When', sortable: true, render: (s) => formatDateTime(s.checkedInAt) },
          { accessor: 'memberName', title: 'Member', sortable: true, render: (s) => <MemberLink id={s.memberId} name={s.memberName} /> },
          { accessor: 'trainerName', title: 'Trainer', sortable: true },
          { accessor: 'packageName', title: 'Session type' },
          { accessor: 'number', title: 'Session', render: (s) => `${s.number} of ${s.sessions}` }
        ]}
      />
    </Stack>
  )
}

function Commission() {
  const [month, setMonth] = useState(todayIso())
  const { data = [], isPending } = useQuery({
    queryKey: ['ptCommission', month.slice(0, 7)],
    queryFn: () => api.personalTraining.commission(month.slice(0, 7))
  })
  const commission = data.reduce((s, t) => s + t.commission, 0)
  return (
    <Stack>
      <Group justify="space-between">
        <MonthPickerInput value={month} onChange={(v) => v && setMonth(v)} valueFormat="MMMM YYYY" w={200} />
        {commission > 0 && <Text fw={600}>Commission this month: {lkr(commission)}</Text>}
      </Group>
      <Text size="sm" c="dimmed">
        Commission is earned on packages starting this month. Check what the member has paid before paying it out.
      </Text>
      {!isPending && data.length === 0 && (
        <Paper p="lg">
          <Text c="dimmed">No personal training sold or given this month.</Text>
        </Paper>
      )}
      {data.map((t) => (
        <Paper key={t.trainerId} p="lg">
          <Group justify="space-between" mb="sm" align="flex-start">
            <div>
              <Title order={4}>{t.trainerName}</Title>
              <Text size="sm" c="dimmed">
                {t.packages.length} package{t.packages.length === 1 ? '' : 's'} sold · {lkr(t.total)} · paid so far{' '}
                {lkr(t.paid)} · {t.sessions} session{t.sessions === 1 ? '' : 's'} given
              </Text>
            </div>
            {t.isOwner ? (
              <Badge variant="light">Owner · no commission</Badge>
            ) : (
              <div style={{ textAlign: 'right' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Commission
                </Text>
                <Text fz={22} fw={700}>
                  {lkr(t.commission)}
                </Text>
              </div>
            )}
          </Group>
          {t.packages.length > 0 && (
            <Table verticalSpacing={6} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Starts</Table.Th>
                  <Table.Th>Member</Table.Th>
                  <Table.Th>Session type</Table.Th>
                  <Table.Th ta="right">Price</Table.Th>
                  <Table.Th ta="right">Paid</Table.Th>
                  {!t.isOwner && <Table.Th ta="right">Commission</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {t.packages.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td style={nowrap}>{formatDate(p.startDate)}</Table.Td>
                    <Table.Td>
                      <MemberLink id={p.memberId} name={p.memberName} />
                    </Table.Td>
                    <Table.Td>{p.packageName}</Table.Td>
                    <Table.Td ta="right">{lkr(p.amount)}</Table.Td>
                    <Table.Td ta="right" c={p.balance > 0 ? 'var(--app-red-text)' : undefined}>
                      {p.balance > 0 ? `${lkr(p.paid)} (owes ${lkr(p.balance)})` : lkr(p.paid)}
                    </Table.Td>
                    {!t.isOwner && (
                      <Table.Td ta="right" fw={600}>
                        {lkr(p.commission)}
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
      ))}
    </Stack>
  )
}

function SessionTypeForm({ type, onClose }: { type?: PtPackage; onClose: () => void }) {
  const form = useForm<PtPackageInput>({
    initialValues: type
      ? {
          name: type.name,
          sessions: type.sessions,
          price: type.price,
          validDuration: type.validDuration,
          validDurationType: type.validDurationType
        }
      : ({ name: '', sessions: '', price: '', validDuration: 1, validDurationType: 'MONTH' } as unknown as PtPackageInput),
    validate: schemaResolver(ptPackageInput, { sync: true })
  })
  const save = useAction(
    (v: PtPackageInput) => (type ? api.ptPackages.update(type.id, v) : api.ptPackages.create(v)),
    { success: type ? 'Session type updated' : 'Session type added' }
  )
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <TextInput label="Name" placeholder="e.g. 12 sessions" withAsterisk data-autofocus {...form.getInputProps('name')} />
        <Group grow align="flex-start">
          <NumberInput label="Sessions" min={1} allowDecimal={false} withAsterisk {...form.getInputProps('sessions')} />
          <NumberInput label="Price" prefix="Rs. " min={0} withAsterisk {...form.getInputProps('price')} />
        </Group>
        <Group grow align="flex-start">
          <NumberInput label="Use within" min={1} allowDecimal={false} {...form.getInputProps('validDuration')} />
          <Select
            label=" "
            data={DURATION_TYPES.map((t) => ({ value: t, label: `${DURATION_TYPE_LABELS[t]}s` }))}
            {...form.getInputProps('validDurationType')}
          />
        </Group>
        <Text size="xs" c="dimmed">
          Sessions left after that can’t be used at check-in. The date can be moved on for one member by editing their
          package.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {type ? 'Save changes' : 'Add session type'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

function SessionTypes() {
  const { data = [], isPending } = usePtPackages()
  const [editing, setEditing] = useState<{ type?: PtPackage } | null>(null)
  const archive = useAction((id: string, archived: boolean) => api.ptPackages.setArchived(id, archived))
  const remove = useAction((id: string) => api.ptPackages.delete(id), { success: 'Session type deleted' })
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          The packages you sell. The sessions and price can still be changed when selling one.
        </Text>
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setEditing({})}>
          Add session type
        </Button>
      </Group>
      <AppTable<PtPackage>
        records={data}
        fetching={isPending}
        emptyText="No session types yet"
        columns={[
          {
            accessor: 'name',
            title: 'Name',
            render: (k) => (
              <Group gap="xs">
                <Text size="sm" c={k.archived ? 'dimmed' : undefined}>
                  {k.name}
                </Text>
                {k.archived && (
                  <Badge size="xs" variant="light" color="gray">
                    Archived
                  </Badge>
                )}
              </Group>
            )
          },
          { accessor: 'sessions', title: 'Sessions', textAlign: 'right' },
          { accessor: 'price', title: 'Price', textAlign: 'right', render: (k) => lkr(k.price) },
          { accessor: 'validDuration', title: 'Use within', render: (k) => durationLabel(k.validDuration, k.validDurationType) },
          { accessor: 'soldCount', title: 'Sold', textAlign: 'right' },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            render: (k) => (
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <ActionIcon variant="subtle" color="gray" aria-label="Edit" onClick={() => setEditing({ type: k })}>
                  <IconEdit size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={k.archived ? 'Restore' : 'Archive'}
                  title={k.archived ? 'Restore' : 'Archive: hide from new packages'}
                  onClick={() => archive.mutate([k.id, !k.archived])}
                >
                  {k.archived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Delete"
                  onClick={() =>
                    modals.openConfirmModal({
                      title: `Delete "${k.name}"?`,
                      children: <Text size="sm">Only one that was never sold can be deleted; otherwise archive it.</Text>,
                      labels: { confirm: 'Delete', cancel: 'Cancel' },
                      confirmProps: { color: 'red' },
                      onConfirm: () => remove.mutate([k.id])
                    })
                  }
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            )
          }
        ]}
      />
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.type ? 'Edit session type' : 'Add session type'}>
        {editing && <SessionTypeForm type={editing.type} onClose={() => setEditing(null)} />}
      </Modal>
    </Stack>
  )
}

export function PersonalTraining() {
  const [selling, setSelling] = useState<PtStart | null>(null)
  return (
    <>
      <PageHeader
        title="Personal training"
        description="Packages of sessions with a trainer, on top of a membership. Members choose personal training when they check in, which uses a session."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setSelling({})}>
            New package
          </Button>
        }
      />
      <Tabs defaultValue="clients" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="clients">Clients</Tabs.Tab>
          <Tabs.Tab value="sessions">Sessions</Tabs.Tab>
          <Tabs.Tab value="commission">Commission</Tabs.Tab>
          <Tabs.Tab value="types">Session types</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="clients">
          <Clients />
        </Tabs.Panel>
        <Tabs.Panel value="sessions">
          <Sessions />
        </Tabs.Panel>
        <Tabs.Panel value="commission">
          <Commission />
        </Tabs.Panel>
        <Tabs.Panel value="types">
          <SessionTypes />
        </Tabs.Panel>
      </Tabs>
      <PtSellModal start={selling} onClose={() => setSelling(null)} />
    </>
  )
}

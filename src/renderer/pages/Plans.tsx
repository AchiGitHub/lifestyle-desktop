import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { IconArchive, IconArchiveOff, IconDots, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Duration, JoiningFeeSettings, MembershipType } from '@shared/api'
import { DURATION_TYPES, DURATION_TYPE_LABELS, durationLabel } from '@shared/enums'
import {
  durationInput,
  joiningFeeSettingsInput,
  membershipTypeInput,
  type DurationInput,
  type JoiningFeeSettingsInput,
  type MembershipTypeInput
} from '@shared/schemas'
import { AppTable } from '../components/AppTable'
import { PageHeader } from '../components/PageHeader'
import { api, useAction } from '../lib/api'
import { lkr } from '../lib/format'
import { useDurations, useMembershipTypes } from '../lib/queries'

function PlanForm({
  plan,
  durations,
  defaultJoiningFee,
  onClose
}: {
  plan?: MembershipType
  durations: Duration[]
  defaultJoiningFee: number
  onClose: () => void
}) {
  const form = useForm<MembershipTypeInput>({
    initialValues: plan
      ? {
          name: plan.name,
          price: plan.price,
          numberOfMembers: plan.numberOfMembers,
          durationId: plan.durationId,
          joiningFee: plan.joiningFee
        }
      : ({
          name: '',
          price: '',
          numberOfMembers: 1,
          durationId: '',
          joiningFee: defaultJoiningFee
        } as unknown as MembershipTypeInput),
    validate: schemaResolver(membershipTypeInput, { sync: true })
  })
  const save = useAction(
    (v: MembershipTypeInput) => (plan ? api.membershipTypes.update(plan.id, v) : api.membershipTypes.create(v)),
    { success: plan ? 'Plan updated' : 'Plan added' }
  )
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <TextInput label="Name" placeholder="e.g. Three Months Couple" withAsterisk data-autofocus {...form.getInputProps('name')} />
        <Select
          label="Duration"
          withAsterisk
          data={durations.map((d) => ({ value: d.id, label: durationLabel(d.duration, d.durationType) }))}
          {...form.getInputProps('durationId')}
        />
        <Group grow align="flex-start">
          <NumberInput label="People" min={1} max={10} allowDecimal={false} withAsterisk {...form.getInputProps('numberOfMembers')} />
          <NumberInput label="Price" prefix="Rs. " min={0} withAsterisk {...form.getInputProps('price')} />
        </Group>
        <NumberInput
          label="Joining fee per new member"
          description="Added on top of the price for each person joining. Use 0 for no joining fee."
          prefix="Rs. "
          min={0}
          {...form.getInputProps('joiningFee')}
        />
        {plan && plan.registrationCount > 0 && (
          <Text size="xs" c="dimmed">
            Changes apply to new registrations. The {plan.registrationCount} existing registrations keep their dates and
            amounts.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {plan ? 'Save changes' : 'Add plan'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

function DurationForm({ duration, onClose }: { duration?: Duration; onClose: () => void }) {
  const form = useForm<DurationInput>({
    initialValues: duration
      ? { duration: duration.duration, durationType: duration.durationType }
      : { duration: 1, durationType: 'MONTH' },
    validate: schemaResolver(durationInput, { sync: true })
  })
  const save = useAction(
    (v: DurationInput) => (duration ? api.durations.update(duration.id, v) : api.durations.create(v)),
    { success: duration ? 'Duration updated' : 'Duration added' }
  )
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <Group grow align="flex-end">
          <NumberInput label="Length" min={1} allowDecimal={false} withAsterisk data-autofocus {...form.getInputProps('duration')} />
          <SegmentedControl
            data={DURATION_TYPES.map((t) => ({ value: t, label: `${DURATION_TYPE_LABELS[t]}s` }))}
            {...form.getInputProps('durationType')}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {duration ? 'Save changes' : 'Add duration'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

/** When returning members pay the joining fee again. */
function JoiningFeeRuleForm({ settings }: { settings: JoiningFeeSettings }) {
  const form = useForm<JoiningFeeSettingsInput>({
    initialValues: settings,
    validate: schemaResolver(joiningFeeSettingsInput, { sync: true })
  })
  const save = useAction((v: JoiningFeeSettingsInput) => api.joiningFee.save(v), { success: 'Saved' })
  return (
    <Paper p="md" mb="md">
      <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: () => form.resetDirty(v) }))}>
        <Group align="center" gap="sm" wrap="wrap">
          <Text size="sm">
            <b>Joining fee:</b> new members pay the plan’s joining fee. Renewals don’t, unless staff tick it; it’s
            pointed out for anyone back after a break of more than
          </Text>
          <NumberInput
            aria-label="Days"
            w={90}
            size="xs"
            min={0}
            allowDecimal={false}
            suffix=" days"
            {...form.getInputProps('breakDays')}
          />
          <Text size="sm">Staff can add or waive it for anyone when registering.</Text>
          {form.isDirty() && (
            <Button type="submit" size="xs" loading={save.isPending}>
              Save
            </Button>
          )}
        </Group>
      </form>
    </Paper>
  )
}

function JoiningFeeRule() {
  const { data } = useQuery({ queryKey: ['joiningFeeSettings'], queryFn: () => api.joiningFee.settings() })
  return data ? <JoiningFeeRuleForm settings={data} /> : null
}

/** The fee most plans use, for a new plan. */
function commonJoiningFee(plans: MembershipType[]): number {
  const counts = new Map<number, number>()
  for (const p of plans) if (!p.archived && p.joiningFee > 0) counts.set(p.joiningFee, (counts.get(p.joiningFee) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

function confirmDelete(what: string, onConfirm: () => void) {
  modals.openConfirmModal({
    title: `Delete ${what}?`,
    children: <Text size="sm">This can’t be undone.</Text>,
    labels: { confirm: 'Delete', cancel: 'Cancel' },
    confirmProps: { color: 'red' },
    onConfirm
  })
}

export function Plans() {
  const { data: plans = [], isPending } = useMembershipTypes()
  const { data: durations = [], isPending: durationsPending } = useDurations()
  const [showArchived, setShowArchived] = useState(false)
  const [editingPlan, setEditingPlan] = useState<{ plan?: MembershipType } | null>(null)
  const [editingDuration, setEditingDuration] = useState<{ duration?: Duration } | null>(null)
  const archive = useAction((id: string, archived: boolean) => api.membershipTypes.setArchived(id, archived), {
    success: 'Saved'
  })
  const deletePlan = useAction((id: string) => api.membershipTypes.delete([id]), {
    success: 'Plan deleted',
    errorTitle: 'Couldn’t delete'
  })
  const deleteDuration = useAction((id: string) => api.durations.delete([id]), {
    success: 'Duration deleted',
    errorTitle: 'Couldn’t delete'
  })

  const archivedCount = plans.filter((p) => p.archived).length
  const visible = plans.filter((p) => showArchived || !p.archived)

  return (
    <>
      <PageHeader
        title="Plans"
        description="Membership plans offered at the front desk, and the durations they use"
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditingPlan({})}>
            Add plan
          </Button>
        }
      />
      <JoiningFeeRule />
      <Group mb="md">
        <Switch
          label={`Show archived plans (${archivedCount})`}
          checked={showArchived}
          onChange={(e) => setShowArchived(e.currentTarget.checked)}
        />
      </Group>
      <AppTable<MembershipType>
        records={visible}
        fetching={isPending}
        pageSize={50}
        sort={{ columnAccessor: 'name', direction: 'asc' }}
        emptyText="No plans yet"
        columns={[
          {
            accessor: 'name',
            title: 'Plan',
            sortable: true,
            render: (p) => (
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  {p.name}
                </Text>
                {p.archived && (
                  <Badge size="xs" color="gray">
                    Archived
                  </Badge>
                )}
              </Group>
            )
          },
          { accessor: 'duration', title: 'Duration', render: (p) => durationLabel(p.duration, p.durationType) },
          { accessor: 'numberOfMembers', title: 'People', sortable: true, textAlign: 'right' },
          { accessor: 'price', title: 'Price', sortable: true, textAlign: 'right', render: (p) => lkr(p.price) },
          {
            accessor: 'joiningFee',
            title: 'Joining fee',
            sortable: true,
            textAlign: 'right',
            render: (p) =>
              p.joiningFee > 0 ? (
                `${lkr(p.joiningFee)}${p.numberOfMembers > 1 ? ' each' : ''}`
              ) : (
                <Text span size="sm" c="dimmed">
                  None
                </Text>
              )
          },
          { accessor: 'registrationCount', title: 'Registrations', sortable: true, textAlign: 'right' },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            render: (p) => (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label="Plan actions">
                    <IconDots size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditingPlan({ plan: p })}>
                    Edit
                  </Menu.Item>
                  <Menu.Item
                    leftSection={p.archived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                    onClick={() => archive.mutate([p.id, !p.archived])}
                  >
                    {p.archived ? 'Bring back' : 'Archive (hide from new registrations)'}
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    disabled={p.registrationCount > 0}
                    onClick={() => confirmDelete(`“${p.name}”`, () => deletePlan.mutate([p.id]))}
                  >
                    {p.registrationCount > 0 ? 'Delete (in use, archive instead)' : 'Delete'}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )
          }
        ]}
      />

      <Group justify="space-between" mt="xl" mb="md">
        <Title order={4}>Durations</Title>
        <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditingDuration({})}>
          Add duration
        </Button>
      </Group>
      <AppTable<Duration>
        records={durations}
        fetching={durationsPending}
        emptyText="No durations yet"
        columns={[
          { accessor: 'duration', title: 'Duration', render: (d) => durationLabel(d.duration, d.durationType) },
          { accessor: 'planCount', title: 'Used by plans', textAlign: 'right' },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            render: (d) => (
              <Group gap="xs" justify="flex-end">
                <ActionIcon variant="subtle" color="gray" aria-label="Edit" onClick={() => setEditingDuration({ duration: d })}>
                  <IconEdit size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Delete"
                  disabled={d.planCount > 0}
                  onClick={() =>
                    confirmDelete(durationLabel(d.duration, d.durationType), () => deleteDuration.mutate([d.id]))
                  }
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            )
          }
        ]}
      />

      <Modal opened={editingPlan !== null} onClose={() => setEditingPlan(null)} title={editingPlan?.plan ? 'Edit plan' : 'Add plan'}>
        {editingPlan && (
          <PlanForm
            plan={editingPlan.plan}
            durations={durations}
            defaultJoiningFee={commonJoiningFee(plans)}
            onClose={() => setEditingPlan(null)}
          />
        )}
      </Modal>
      <Modal
        opened={editingDuration !== null}
        onClose={() => setEditingDuration(null)}
        title={editingDuration?.duration ? 'Edit duration' : 'Add duration'}
      >
        {editingDuration && <DurationForm duration={editingDuration.duration} onClose={() => setEditingDuration(null)} />}
      </Modal>
    </>
  )
}

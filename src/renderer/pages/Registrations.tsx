import { ActionIcon, Button, Group, Menu, SegmentedControl, Select, Text, TextInput } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconCash, IconDots, IconPencil, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Registration } from '@shared/api'
import { PageHeader } from '../components/PageHeader'
import { AddPaymentModal, EditRegistrationModal } from '../components/RegistrationModals'
import { RegistrationTable } from '../components/RegistrationTable'
import { REGISTRATION_LOOK, registrationState, type RegistrationState } from '../components/StatusBadge'
import { api, useAction } from '../lib/api'
import { lkr } from '../lib/format'
import { useMembershipTypes } from '../lib/queries'
import { matchesRegistration } from '../lib/search'

/** "current" is everything that hasn't ended: upcoming, active and expiring. */
type StatusFilter = 'current' | RegistrationState | 'any'

const STATES: RegistrationState[] = ['active', 'expiring', 'upcoming', 'expired', 'renewed', 'dismissed']
const STATUS_OPTIONS = [
  { value: 'current', label: 'Current' },
  ...STATES.map((s) => ({ value: s, label: REGISTRATION_LOOK[s].label })),
  { value: 'any', label: 'Any status' }
]
const NOT_ENDED: StatusFilter[] = ['current', 'active', 'expiring', 'upcoming']

export function Registrations() {
  const navigate = useNavigate()
  // Filters live in the address, so coming back from Renew keeps them.
  const [params, setParams] = useSearchParams()
  const status = (STATUS_OPTIONS.some((o) => o.value === params.get('status')) ? params.get('status') : 'current') as StatusFilter
  const plan = params.get('plan')
  const owing = params.get('owing') === '1'
  const setFilter = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value === null) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true }
    )
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState<Registration | null>(null)
  const [editing, setEditing] = useState<Registration | null>(null)
  // Only load ended registrations when the filter needs them.
  const scope = NOT_ENDED.includes(status) ? 'active' : 'all'
  const { data = [], isPending } = useQuery({
    queryKey: ['registrations', scope],
    queryFn: () => api.registrations.list({ status: scope })
  })
  const { data: types = [] } = useMembershipTypes()
  const remove = useAction((ids: string[]) => api.registrations.delete(ids), {
    success: 'Registration deleted',
    errorTitle: 'Couldn’t delete'
  })

  const planOptions = useMemo(() => {
    const option = (t: (typeof types)[number]) => ({ value: t.id, label: t.name })
    const current = types.filter((t) => !t.archived).map(option)
    const archived = types.filter((t) => t.archived && t.registrationCount > 0).map(option)
    return archived.length > 0
      ? [
          { group: 'Plans', items: current },
          { group: 'Archived plans', items: archived }
        ]
      : current
  }, [types])

  const records = useMemo(
    () =>
      data.filter(
        (r) =>
          (status === 'current' || status === 'any' || registrationState(r) === status) &&
          (!plan || r.membershipTypeId === plan) &&
          (!owing || r.balance > 0) &&
          matchesRegistration(r, search)
      ),
    [data, status, plan, owing, search]
  )
  const owed = records.reduce((sum, r) => sum + r.balance, 0)
  const filtered = status !== 'current' || plan !== null || owing || search.trim() !== ''

  return (
    <>
      <PageHeader
        title="Registrations"
        description={`${records.length.toLocaleString()} ${records.length === 1 ? 'registration' : 'registrations'}${owed > 0 ? ` · ${lkr(owed)} outstanding` : ''}`}
      />
      <Group mb="md" gap="sm">
        <TextInput
          w={210}
          placeholder="Search name or phone"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Select
          w={140}
          aria-label="Status"
          data={STATUS_OPTIONS}
          value={status}
          allowDeselect={false}
          onChange={(v) => setFilter('status', v === 'current' ? null : v)}
        />
        <Select
          w={200}
          aria-label="Plan"
          placeholder="All plans"
          data={planOptions}
          value={plan}
          searchable
          clearable
          nothingFoundMessage="No plan by that name"
          onChange={(v) => setFilter('plan', v)}
        />
        <SegmentedControl
          value={owing ? 'owing' : 'any'}
          onChange={(v) => setFilter('owing', v === 'owing' ? '1' : null)}
          data={[
            { value: 'any', label: 'Any balance' },
            { value: 'owing', label: 'Owing money' }
          ]}
        />
        {filtered && (
          <Button
            variant="subtle"
            color="gray"
            onClick={() => {
              setSearch('')
              setParams({}, { replace: true })
            }}
          >
            Clear filters
          </Button>
        )}
      </Group>

      <RegistrationTable
        records={records}
        fetching={isPending}
        emptyText={filtered ? 'No registration matches these filters' : 'No current registrations'}
        actions={(r) => (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Registration actions">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconCash size={16} />} onClick={() => setPaying(r)}>
                Add payment
              </Menu.Item>
              <Menu.Item
                leftSection={<IconRefresh size={16} />}
                onClick={() => navigate(`/registrations/new?renew=${r.id}`)}
              >
                Renew
              </Menu.Item>
              <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(r)}>
                Edit
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                disabled={r.paid > 0}
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Delete this registration?',
                    children: <Text size="sm">It has no payments. This can’t be undone.</Text>,
                    labels: { confirm: 'Delete', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => remove.mutate([[r.id]])
                  })
                }
              >
                {r.paid > 0 ? 'Delete (has payments)' : 'Delete'}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      />

      <AddPaymentModal registration={paying} onClose={() => setPaying(null)} />
      <EditRegistrationModal registration={editing} onClose={() => setEditing(null)} />
    </>
  )
}

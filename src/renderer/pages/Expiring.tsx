import { Button, Group, Switch, TextInput } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { IconEyeOff, IconSearch } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { Registration } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import { PageHeader } from '../components/PageHeader'
import { RegistrationTable } from '../components/RegistrationTable'
import { api } from '../lib/api'
import { matchesRegistration } from '../lib/search'
import { FollowUpActions, useDismiss } from './dismiss'

export function Expiring() {
  const [month, setMonth] = useState<string>(todayIso())
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<Registration[]>([])
  const range = monthRange(month)
  const { data = [], isPending } = useQuery({
    queryKey: ['expiring', range.from, range.to],
    queryFn: () => api.registrations.expiring(range)
  })
  const { dismiss } = useDismiss()

  const records = useMemo(
    () => data.filter((r) => (showAll || (!r.renewed && !r.dismissedAt)) && matchesRegistration(r, search)),
    [data, search, showAll]
  )
  const hiddenCount = data.filter((r) => r.renewed || r.dismissedAt).length

  return (
    <>
      <PageHeader
        title="Renewals due"
        description="Memberships ending in the chosen month. Message or call them, then renew or dismiss."
        actions={
          <MonthPickerInput
            value={month}
            onChange={(v) => v && setMonth(v)}
            valueFormat="MMMM YYYY"
            w={200}
          />
        }
      />
      <Group mb="md" justify="space-between">
        <Group>
          <TextInput
            w={320}
            placeholder="Search member, phone or plan"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Switch
            label={`Show renewed and dismissed (${hiddenCount})`}
            checked={showAll}
            onChange={(e) => setShowAll(e.currentTarget.checked)}
          />
        </Group>
        {selected.length > 0 && (
          <Button
            variant="light"
            leftSection={<IconEyeOff size={16} />}
            onClick={() => dismiss.mutate([selected.map((r) => r.id)], { onSuccess: () => setSelected([]) })}
          >
            Dismiss {selected.length}
          </Button>
        )}
      </Group>
      <RegistrationTable
        records={records}
        fetching={isPending}
        selected={selected}
        onSelectedChange={setSelected}
        showMoney={false}
        showRelativeEnd
        defaultSort="endDate"
        sortDirection="asc"
        emptyText="Nobody to follow up this month"
        actions={(r) => <FollowUpActions registration={r} />}
      />
    </>
  )
}

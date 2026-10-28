import { Button, Group, SegmentedControl, Switch, TextInput } from '@mantine/core'
import { IconEyeOff, IconSearch } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { Registration } from '@shared/api'
import { addDays, todayIso } from '@shared/dates'
import { PageHeader } from '../components/PageHeader'
import { RegistrationTable } from '../components/RegistrationTable'
import { api } from '../lib/api'
import { matchesRegistration } from '../lib/search'
import { FollowUpActions, useDismiss } from './dismiss'

const PERIODS = { '30': 30, '90': 90, '365': 365, all: null } as const
type Period = keyof typeof PERIODS

export function Expired() {
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('90')
  const [showDismissed, setShowDismissed] = useState(false)
  const [selected, setSelected] = useState<Registration[]>([])
  const { data = [], isPending } = useQuery({ queryKey: ['expired'], queryFn: () => api.registrations.expired() })
  const { dismiss } = useDismiss()

  const records = useMemo(() => {
    const days = PERIODS[period]
    const since = days === null ? '' : addDays(todayIso(), -days)
    return data.filter(
      (r) => r.endDate >= since && (showDismissed || !r.dismissedAt) && matchesRegistration(r, search)
    )
  }, [data, period, showDismissed, search])

  return (
    <>
      <PageHeader
        title="Not renewed"
        description="People whose membership ended and who haven’t renewed. Win them back, or dismiss them."
      />
      <Group mb="md" justify="space-between">
        <Group>
          <TextInput
            w={300}
            placeholder="Search member, phone or plan"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <SegmentedControl
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            data={[
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' },
              { value: 'all', label: 'All' }
            ]}
          />
          <Switch
            label="Show dismissed"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.currentTarget.checked)}
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
        emptyText="Nobody here"
        actions={(r) => <FollowUpActions registration={r} />}
      />
    </>
  )
}

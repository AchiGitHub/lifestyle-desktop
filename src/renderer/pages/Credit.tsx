import { ActionIcon, Anchor, Badge, Button, Group, Stack, Tabs, Text } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { CreditSale, MemberCredit } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import { AppTable } from '../components/AppTable'
import { CreditPaymentModal, CreditReminderButton } from '../components/credit'
import { useMemberDrawer } from '../components/MemberDrawer'
import { PageHeader } from '../components/PageHeader'
import { api, useAction } from '../lib/api'
import { formatDate, formatDateTime, fullName, lkr, relativeDays } from '../lib/format'

type OwedRow = MemberCredit & { id: string }

/** "Yeti Isotonic × 3, Protein bar × 1 and 2 more", the same product taken twice counted together. */
function itemSummary(c: MemberCredit): string {
  const byProduct = new Map<string, number>()
  for (const i of c.items) byProduct.set(i.productName, (byProduct.get(i.productName) ?? 0) + i.quantity)
  const all = [...byProduct].map(([name, quantity]) => `${name} × ${quantity}`)
  const shown = all.slice(0, 2)
  return all.length > shown.length ? `${shown.join(', ')} and ${all.length - shown.length} more` : shown.join(', ')
}

const nowrap = { whiteSpace: 'nowrap' } as const

function WhoOwes() {
  const { data = [], isPending } = useQuery({ queryKey: ['credit', 'owed'], queryFn: () => api.credit.owed() })
  const rows = useMemo<OwedRow[]>(() => data.map((c) => ({ ...c, id: c.memberId })), [data])
  const [paying, setPaying] = useState<MemberCredit | null>(null)
  const { openMember } = useMemberDrawer()
  const total = data.reduce((s, c) => s + c.owed, 0)
  return (
    <Stack>
      {data.length > 0 && (
        <Text fw={600}>
          {data.length === 1 ? '1 member owes' : `${data.length} members owe`} {lkr(total)}
        </Text>
      )}
      <AppTable<OwedRow>
        records={rows}
        fetching={isPending}
        sort={{ columnAccessor: 'owed', direction: 'desc' }}
        sortValues={{ name: (c) => fullName(c), since: (c) => c.items[0]?.soldAt }}
        emptyText="Nobody owes anything for store items"
        columns={[
          {
            accessor: 'name',
            title: 'Member',
            sortable: true,
            render: (c) => (
              <div>
                <Anchor component="button" size="sm" fw={600} ta="left" onClick={() => openMember(c.memberId)}>
                  {fullName(c)}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {c.mobileNumber ?? 'No mobile number'}
                </Text>
              </div>
            )
          },
          {
            accessor: 'items',
            title: 'For',
            render: (c) => (
              <Text size="sm" lineClamp={2}>
                {itemSummary(c)}
              </Text>
            )
          },
          {
            accessor: 'since',
            title: 'Oldest',
            sortable: true,
            render: (c) =>
              c.items[0] && (
                <div>
                  <Text size="sm" style={nowrap}>
                    {formatDate(c.items[0].soldAt)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {relativeDays(c.items[0].soldAt.slice(0, 10))}
                  </Text>
                </div>
              )
          },
          {
            accessor: 'lastPaidAt',
            title: 'Last paid',
            sortable: true,
            render: (c) => (
              <Text size="sm" c={c.lastPaidAt ? undefined : 'dimmed'} style={nowrap}>
                {c.lastPaidAt ? formatDate(c.lastPaidAt) : 'Not yet'}
              </Text>
            )
          },
          {
            accessor: 'owed',
            title: 'Owes',
            sortable: true,
            textAlign: 'right',
            render: (c) => (
              <Text fw={700} c="red.7" style={nowrap}>
                {lkr(c.owed)}
              </Text>
            )
          },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            render: (c) => (
              <Group gap="xs" justify="flex-end" wrap="nowrap">
                <CreditReminderButton credit={c} />
                <Button size="xs" onClick={() => setPaying(c)}>
                  Take payment
                </Button>
              </Group>
            )
          }
        ]}
      />
      <CreditPaymentModal credit={paying} onClose={() => setPaying(null)} />
    </Stack>
  )
}

function CreditSales() {
  const [month, setMonth] = useState(todayIso())
  const range = monthRange(month)
  const { data = [], isPending } = useQuery({
    queryKey: ['credit', 'sales', range.from, range.to],
    queryFn: () => api.credit.sales(range)
  })
  const remove = useAction((id: string) => api.credit.deleteSale(id), { success: 'Credit sale deleted' })
  const { openMember } = useMemberDrawer()
  const total = data.reduce((s, c) => s + c.amount, 0)
  const owed = data.reduce((s, c) => s + c.owed, 0)
  return (
    <Stack>
      <Group justify="space-between">
        <MonthPickerInput value={month} onChange={(v) => v && setMonth(v)} valueFormat="MMMM YYYY" w={200} />
        <Text fw={600}>
          {data.length} on credit · {lkr(total)}
          {owed > 0 && (
            <Text span c="red.7">
              {' '}
              · {lkr(owed)} still to pay
            </Text>
          )}
        </Text>
      </Group>
      <AppTable<CreditSale>
        records={data}
        fetching={isPending}
        sort={{ columnAccessor: 'soldAt', direction: 'desc' }}
        emptyText="Nothing sold on credit this month"
        columns={[
          { accessor: 'soldAt', title: 'Date', sortable: true, render: (c) => formatDateTime(c.soldAt) },
          { accessor: 'productName', title: 'Item', sortable: true, render: (c) => `${c.productName} × ${c.quantity}` },
          {
            accessor: 'memberName',
            title: 'Member',
            sortable: true,
            render: (c) => (
              <Anchor component="button" size="sm" onClick={() => openMember(c.memberId)}>
                {c.memberName}
              </Anchor>
            )
          },
          {
            accessor: 'recordedBy',
            title: 'By',
            render: (c) =>
              c.recordedBy ?? (
                <Text size="sm" c="dimmed">
                  Front desk
                </Text>
              )
          },
          { accessor: 'amount', title: 'Amount', sortable: true, textAlign: 'right', render: (c) => lkr(c.amount) },
          {
            accessor: 'owed',
            title: 'Paid?',
            sortable: true,
            render: (c) =>
              c.owed === 0 ? (
                <Badge color="teal" variant="light">
                  Paid
                </Badge>
              ) : c.owed < c.amount ? (
                <Badge color="orange" variant="light">
                  {lkr(c.owed)} left
                </Badge>
              ) : (
                <Badge color="red" variant="light">
                  To pay
                </Badge>
              )
          },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            width: 60,
            render: (c) => (
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Delete credit sale"
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Delete this credit sale?',
                    children: (
                      <Text size="sm">
                        {c.productName} × {c.quantity} for {c.memberName}, {lkr(c.amount)}. Only do this to fix a mistake: it
                        comes off what they owe and the items go back into stock.
                        {c.owed < c.amount && ' What they paid towards it goes towards their other items.'}
                      </Text>
                    ),
                    labels: { confirm: 'Delete', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => remove.mutate([c.id])
                  })
                }
              >
                <IconTrash size={16} />
              </ActionIcon>
            )
          }
        ]}
      />
    </Stack>
  )
}

export function Credit() {
  return (
    <>
      <PageHeader
        title="On credit"
        description="Store items members took to pay for later. To sell on credit, choose On credit when selling in the Store"
      />
      <Tabs defaultValue="owed" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="owed">Who owes</Tabs.Tab>
          <Tabs.Tab value="sales">Credit sales</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="owed">
          <WhoOwes />
        </Tabs.Panel>
        <Tabs.Panel value="sales">
          <CreditSales />
        </Tabs.Panel>
      </Tabs>
    </>
  )
}

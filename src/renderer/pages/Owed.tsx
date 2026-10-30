import { ActionIcon, Anchor, Badge, Button, Group, Menu, Stack, Switch, Tabs, Text } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { IconChevronDown, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { CreditSale, MemberCredit, MemberOwed, OwedDebt } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import { AppTable } from '../components/AppTable'
import { CreditPaymentModal, OwedReminderButton } from '../components/credit'
import { useMemberDrawer } from '../components/MemberDrawer'
import { PageHeader } from '../components/PageHeader'
import { AddPaymentModal } from '../components/RegistrationModals'
import { PtPaymentModal } from '../components/training'
import { api, useAction } from '../lib/api'
import { formatDate, formatDateTime, fullName, lkr, relativeDays } from '../lib/format'
import { CATEGORY_BADGE } from './Payments'

type OwedRow = MemberOwed & { id: string; shown: OwedDebt[]; owed: number }

const DEBT_LABELS: Record<OwedDebt['kind'], string> = {
  MEMBERSHIP: 'Membership',
  PERSONAL_TRAINING: 'Personal training',
  STORE_CREDIT: 'Store items'
}

/** "Yeti Isotonic × 3, Protein bar × 1 and 2 more", the same product taken twice counted together. */
function itemSummary(c: MemberCredit): string {
  const byProduct = new Map<string, number>()
  for (const i of c.items) byProduct.set(i.productName, (byProduct.get(i.productName) ?? 0) + i.quantity)
  const all = [...byProduct].map(([name, quantity]) => `${name} × ${quantity}`)
  const shown = all.slice(0, 2)
  return all.length > shown.length ? `${shown.join(', ')} and ${all.length - shown.length} more` : shown.join(', ')
}

/** What it's for, and when (a membership or package's dates). */
function describe(debt: OwedDebt, memberId: string): { title: string; dates: string | null } {
  const dates = (from: string, to: string) => `${formatDate(from)} – ${formatDate(to)}`
  switch (debt.kind) {
    case 'MEMBERSHIP': {
      const r = debt.registration
      const others = r.members.filter((m) => m.id !== memberId).map(fullName)
      return {
        title: `${r.membershipTypeName}${others.length ? ` (with ${others.join(', ')})` : ''}`,
        dates: dates(r.startDate, r.endDate)
      }
    }
    case 'PERSONAL_TRAINING':
      return { title: `${debt.pt.packageName} with ${debt.pt.trainerName}`, dates: dates(debt.pt.startDate, debt.pt.endDate) }
    case 'STORE_CREDIT':
      return { title: itemSummary(debt.credit), dates: null }
  }
}

const nowrap = { whiteSpace: 'nowrap' } as const
const keyOf = (d: OwedDebt) =>
  d.kind === 'MEMBERSHIP' ? d.registration.id : d.kind === 'PERSONAL_TRAINING' ? d.pt.id : `store-${d.credit.memberId}`

/** Straight to the payment dialog, or a choice of what to pay towards when they owe for more than one thing. */
function TakePayment({ row, onPay }: { row: OwedRow; onPay: (debt: OwedDebt) => void }) {
  if (row.shown.length === 1) {
    return (
      <Button size="xs" onClick={() => onPay(row.shown[0])}>
        Take payment
      </Button>
    )
  }
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button size="xs" rightSection={<IconChevronDown size={14} />}>
          Take payment
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Pay towards</Menu.Label>
        {row.shown.map((d) => (
          <Menu.Item
            key={keyOf(d)}
            onClick={() => onPay(d)}
            rightSection={
              <Text size="xs" c="dimmed" ml="md">
                {lkr(d.owed)}
              </Text>
            }
          >
            {DEBT_LABELS[d.kind]}: {describe(d, row.memberId).title}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

function WhoOwes() {
  const { data = [], isPending } = useQuery({ queryKey: ['owed'], queryFn: () => api.owed.list() })
  const [showOlder, setShowOlder] = useState(false)
  const rows = useMemo<OwedRow[]>(
    () =>
      data
        .map((m) => {
          const shown = m.debts.filter((d) => showOlder || !d.older)
          const owed = Math.round(shown.reduce((s, d) => s + d.owed, 0) * 100) / 100
          return { ...m, id: m.memberId, shown, owed }
        })
        .filter((r) => r.shown.length > 0),
    [data, showOlder]
  )
  const older = data.flatMap((m) => m.debts.filter((d) => d.older))
  const [paying, setPaying] = useState<OwedDebt | null>(null)
  const close = () => setPaying(null)
  const { openMember } = useMemberDrawer()
  const total = rows.reduce((s, r) => s + r.owed, 0)
  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={600}>
          {rows.length > 0 && `${rows.length === 1 ? '1 member owes' : `${rows.length} members owe`} ${lkr(total)}`}
        </Text>
        {older.length > 0 && (
          <Switch
            label={`Show ${older.length === 1 ? 'the balance' : `${older.length} balances`} that ended over a year ago (${lkr(older.reduce((s, d) => s + d.owed, 0))})`}
            checked={showOlder}
            onChange={(e) => setShowOlder(e.currentTarget.checked)}
          />
        )}
      </Group>
      <AppTable<OwedRow>
        records={rows}
        fetching={isPending}
        sort={{ columnAccessor: 'owed', direction: 'desc' }}
        sortValues={{ name: (r) => fullName(r), since: (r) => r.shown[0].since }}
        emptyText="Nobody owes anything"
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
            accessor: 'debts',
            title: 'For',
            render: (c) => (
              <Stack gap="xs">
                {c.shown.map((d) => {
                  const { title, dates } = describe(d, c.memberId)
                  return (
                    <div key={keyOf(d)}>
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" variant="light" color={CATEGORY_BADGE[d.kind]} style={{ minWidth: 'max-content' }}>
                          {DEBT_LABELS[d.kind]}
                        </Badge>
                        {c.shown.length > 1 && (
                          <Text size="xs" c="dimmed" style={nowrap}>
                            {lkr(d.owed)}
                          </Text>
                        )}
                      </Group>
                      <Text size="sm" lineClamp={2}>
                        {title}
                      </Text>
                      {dates && (
                        <Text size="xs" c="dimmed">
                          {dates}
                        </Text>
                      )}
                    </div>
                  )
                })}
              </Stack>
            )
          },
          {
            accessor: 'since',
            title: 'Since',
            sortable: true,
            render: (c) => (
              <div>
                <Text size="sm" style={nowrap}>
                  {formatDate(c.shown[0].since)}
                </Text>
                <Text size="xs" c="dimmed" style={nowrap}>
                  {relativeDays(c.shown[0].since)}
                </Text>
              </div>
            )
          },
          {
            accessor: 'owed',
            title: 'Owes',
            sortable: true,
            textAlign: 'right',
            render: (c) => (
              <div>
                <Text fw={700} c="var(--app-red-text)" style={nowrap}>
                  {lkr(c.owed)}
                </Text>
                <Text size="xs" c="dimmed" style={nowrap}>
                  {c.lastPaidAt ? `Last paid ${formatDate(c.lastPaidAt)}` : 'Nothing paid yet'}
                </Text>
              </div>
            )
          },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            // Side by side when there's room, one above the other on a small screen.
            render: (c) => (
              <Group gap="xs" justify="flex-end">
                <OwedReminderButton member={c} remindedAt={c.remindedAt} includeOlder={showOlder} />
                <TakePayment row={c} onPay={setPaying} />
              </Group>
            )
          }
        ]}
      />
      <AddPaymentModal registration={paying?.kind === 'MEMBERSHIP' ? paying.registration : null} onClose={close} />
      <PtPaymentModal pt={paying?.kind === 'PERSONAL_TRAINING' ? paying.pt : null} onClose={close} />
      <CreditPaymentModal credit={paying?.kind === 'STORE_CREDIT' ? paying.credit : null} onClose={close} />
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
            <Text span c="var(--app-red-text)">
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

export function MoneyOwed() {
  return (
    <>
      <PageHeader
        title="Money owed"
        description="Everyone still to pay for a membership, personal training or store items. To sell on credit, choose On credit when selling in the Store"
      />
      <Tabs defaultValue="owed" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="owed">Who owes</Tabs.Tab>
          <Tabs.Tab value="sales">Store credit sales</Tabs.Tab>
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

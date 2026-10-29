import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  MultiSelect,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { IconBrandWhatsapp, IconReceipt, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import type { DaySummary, Payment } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import {
  PAYMENT_CATEGORIES,
  PAYMENT_CATEGORY_LABELS,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS,
  type PaymentCategory,
  type PaymentType
} from '@shared/enums'
import { receiptNumber } from '@shared/format'
import { AccountsReportButton } from '../components/AccountsReport'
import { AppTable } from '../components/AppTable'
import { useMemberDrawer } from '../components/MemberDrawer'
import { PageHeader } from '../components/PageHeader'
import { useReceipt } from '../components/ReceiptDialog'
import { api, useAction } from '../lib/api'
import { formatDateTime, lkr } from '../lib/format'

export const CATEGORY_BADGE: Record<PaymentCategory, string> = {
  MEMBERSHIP: 'brand',
  PERSONAL_TRAINING: 'pink',
  SUPPLEMENT: 'grape',
  BEVERAGE: 'flame',
  OTHER: 'gray',
  STORE_CREDIT: 'teal'
}

export function PaymentsTable({
  records,
  fetching,
  showRecordedBy
}: {
  records: Payment[]
  fetching?: boolean
  /** Who recorded each payment: an instructor's name, or the front desk. */
  showRecordedBy?: boolean
}) {
  const remove = useAction((id: string) => api.payments.delete(id), { success: 'Payment deleted' })
  const { showReceipt } = useReceipt()
  const { openMember } = useMemberDrawer()
  return (
    <AppTable<Payment>
      records={records}
      fetching={fetching}
      sort={{ columnAccessor: 'paidAt', direction: 'desc' }}
      emptyText="No payments in this period"
      columns={[
        { accessor: 'paidAt', title: 'Date', sortable: true, render: (p) => formatDateTime(p.paidAt) },
        {
          accessor: 'receiptNo',
          title: 'Receipt',
          sortable: true,
          render: (p) => (p.receiptNo ? receiptNumber(p.receiptNo) : '—')
        },
        {
          accessor: 'description',
          title: 'For',
          sortable: true,
          // Store sales name the member who bought them.
          render: (p) =>
            p.memberId && p.memberName ? (
              <div>
                <Text size="sm">{p.description}</Text>
                <Anchor component="button" size="xs" c="dimmed" onClick={() => openMember(p.memberId!)}>
                  {p.memberName}
                </Anchor>
              </div>
            ) : (
              p.description
            )
        },
        {
          accessor: 'category',
          title: 'Category',
          sortable: true,
          render: (p) => (
            <Badge variant="light" color={CATEGORY_BADGE[p.category]}>
              {PAYMENT_CATEGORY_LABELS[p.category]}
            </Badge>
          )
        },
        { accessor: 'paymentType', title: 'Paid by', render: (p) => PAYMENT_TYPE_LABELS[p.paymentType] },
        ...(showRecordedBy
          ? [
              {
                accessor: 'recordedBy',
                title: 'By',
                render: (p: Payment) =>
                  p.recordedBy ?? (
                    <Text size="sm" c="dimmed">
                      Front desk
                    </Text>
                  )
              }
            ]
          : []),
        { accessor: 'amount', title: 'Amount', sortable: true, textAlign: 'right', render: (p) => <b>{lkr(p.amount)}</b> },
        {
          accessor: 'actions',
          title: '',
          textAlign: 'right',
          width: 90,
          render: (p) => (
            <Group gap={4} justify="flex-end" wrap="nowrap">
              <ActionIcon variant="subtle" color="gray" aria-label="Receipt" onClick={() => showReceipt(p.id)}>
                <IconReceipt size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Delete payment"
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Delete this payment?',
                    children: (
                      <Text size="sm">
                        {lkr(p.amount)} for {p.description}. Only do this to fix a mistake.
                        {p.productId ? ' The items go back into stock.' : ''}
                      </Text>
                    ),
                    labels: { confirm: 'Delete payment', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => remove.mutate([p.id])
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
  )
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fz={22} fw={700}>
        {lkr(value)}
      </Text>
    </Paper>
  )
}

type DayRow = DaySummary & { id: string }

const dash = (
  <Text size="sm" c="dimmed">
    –
  </Text>
)
const amount = (value: number) => (value === 0 ? dash : lkr(value))

/** Takings per day, worked out from the payments: nothing for staff to close or count. */
function DaysTable({ days, fetching, onOpen }: { days: DayRow[]; fetching: boolean; onOpen: (date: string) => void }) {
  const send = useAction((date: string) => api.summary.sendToOwner(date), {
    success: 'Opening WhatsApp. Check the message, then press send.'
  })
  return (
    <AppTable<DayRow>
      records={days}
      fetching={fetching}
      pageSize={31}
      sort={{ columnAccessor: 'date', direction: 'desc' }}
      emptyText="No days in this period"
      columns={[
        {
          accessor: 'date',
          title: 'Day',
          sortable: true,
          render: (d) => (
            <button className="link-button" onClick={() => onOpen(d.date)}>
              {dayjs(d.date).format('ddd D MMM YYYY')}
            </button>
          )
        },
        { accessor: 'count', title: 'Payments', sortable: true, textAlign: 'right', render: (d) => d.count || dash },
        ...PAYMENT_TYPES.map((t) => ({
          accessor: t,
          title: PAYMENT_TYPE_LABELS[t],
          textAlign: 'right' as const,
          render: (d: DayRow) => amount(d.byMethod[t].total)
        })),
        { accessor: 'total', title: 'Total', sortable: true, textAlign: 'right', render: (d) => <b>{amount(d.total)}</b> },
        {
          accessor: 'actions',
          title: '',
          textAlign: 'right',
          width: 60,
          render: (d) => (
            <Tooltip label="Send this day’s summary to the owner on WhatsApp" withinPortal>
              <ActionIcon
                variant="subtle"
                color="green"
                aria-label="Send to owner"
                loading={send.isPending && send.variables?.[0] === d.date}
                onClick={() => send.mutate([d.date])}
              >
                <IconBrandWhatsapp size={18} />
              </ActionIcon>
            </Tooltip>
          )
        }
      ]}
    />
  )
}

export function Payments() {
  const today = todayIso()
  const month = monthRange(today)
  const [view, setView] = useState<'payments' | 'days'>('payments')
  const [range, setRange] = useState<DatesRangeValue<string>>([month.from, month.to])
  const [categories, setCategories] = useState<PaymentCategory[]>([])
  const [paymentType, setPaymentType] = useState<PaymentType | null>(null)
  const [from, to] = range
  const { data = [], isPending } = useQuery({
    queryKey: ['payments', from, to, categories, paymentType],
    queryFn: () => api.payments.list({ from: from!, to: to!, categories, paymentType }),
    enabled: view === 'payments' && Boolean(from && to)
  })
  // Days up to today; a range wholly in the future has none.
  const lastDay = to && to > today ? today : to
  const days = useQuery({
    queryKey: ['summaryDays', from, lastDay],
    queryFn: () => api.summary.days({ from: from!, to: lastDay! }),
    enabled: view === 'days' && Boolean(from && lastDay && from <= lastDay)
  })
  const dayRows = useMemo(() => (days.data ?? []).map((d) => ({ ...d, id: d.date })), [days.data])

  const totals =
    view === 'payments'
      ? {
          count: data.length,
          total: data.reduce((s, p) => s + p.amount, 0),
          byMethod: (t: PaymentType) => data.filter((p) => p.paymentType === t).reduce((s, p) => s + p.amount, 0)
        }
      : {
          count: dayRows.reduce((s, d) => s + d.count, 0),
          total: dayRows.reduce((s, d) => s + d.total, 0),
          byMethod: (t: PaymentType) => dayRows.reduce((s, d) => s + d.byMethod[t].total, 0)
        }

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment taken, for memberships, personal training and the store"
        actions={<AccountsReportButton />}
      />
      <Group mb="md">
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as 'payments' | 'days')}
          data={[
            { value: 'payments', label: 'Payments' },
            { value: 'days', label: 'By day' }
          ]}
        />
        <DatePickerInput type="range" value={range} onChange={setRange} valueFormat="D MMM YYYY" w={250} />
        {view === 'payments' && (
          <>
            <MultiSelect
              placeholder={categories.length ? undefined : 'All categories'}
              data={PAYMENT_CATEGORIES.map((c) => ({ value: c, label: PAYMENT_CATEGORY_LABELS[c] }))}
              value={categories}
              onChange={(v) => setCategories(v as PaymentCategory[])}
              clearable
              w={240}
            />
            <Select
              placeholder="All methods"
              data={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))}
              value={paymentType}
              onChange={(v) => setPaymentType(v as PaymentType | null)}
              clearable
              w={170}
            />
          </>
        )}
      </Group>
      <Stack>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Total label={`Total (${totals.count} payments)`} value={totals.total} />
          {PAYMENT_TYPES.map((t) => (
            <Total key={t} label={PAYMENT_TYPE_LABELS[t]} value={totals.byMethod(t)} />
          ))}
        </SimpleGrid>
        {view === 'payments' ? (
          <PaymentsTable records={data} fetching={isPending} />
        ) : (
          <DaysTable
            days={dayRows}
            fetching={days.isFetching}
            onOpen={(date) => {
              setRange([date, date])
              setView('payments')
            }}
          />
        )}
      </Stack>
    </>
  )
}

import {
  ActionIcon,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton
} from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { IconArrowDownRight, IconArrowUpRight, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { DashboardReport, MonthFigures } from '@shared/api'
import { addDays, shiftMonth, todayIso } from '@shared/dates'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS } from '@shared/enums'
import { ChartCard, MonthColumns, MonthLine, SERIES_COLORS, monthName } from '../components/MonthCharts'
import { PageHeader } from '../components/PageHeader'
import { useMemberDrawer } from '../components/MemberDrawer'
import { api } from '../lib/api'
import { compactNumber, formatDate, fullName, lkr, relativeDays } from '../lib/format'

const shortMoney = (value: number) => `Rs. ${compactNumber(value)}`
const percent = (part: number, whole: number) => Math.round((part / whole) * 100)

/** Rupees with a smaller "Rs." so big amounts fit a tile. */
function Money({ value }: { value: number }) {
  return (
    <>
      <Text span fz="sm" fw={600} c="dimmed">
        Rs.
      </Text>{' '}
      {value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
    </>
  )
}

/** "+12% vs 1–28 Sep": an arrow and green when up, red when down. */
function Change({ by, unit = '', text }: { by: number; unit?: string; text: string }) {
  const Icon = by > 0 ? IconArrowUpRight : IconArrowDownRight
  const color = by > 0 ? 'teal.8' : by < 0 ? 'red.8' : 'dimmed'
  return (
    <Group gap={4} wrap="nowrap">
      <Group gap={2} wrap="nowrap" c={color}>
        {by !== 0 && <Icon size={16} stroke={2.2} />}
        <Text span size="sm" fw={600}>
          {by === 0 ? 'No change' : `${by > 0 ? '+' : '−'}${Math.abs(by).toLocaleString()}${unit}`}
        </Text>
      </Group>
      <Text span size="sm" c="dimmed" truncate>
        {text}
      </Text>
    </Group>
  )
}

function Stat({
  label,
  value,
  change,
  hint,
  onClick,
  children
}: {
  label: string
  value: ReactNode
  change?: ReactNode
  hint?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  const body = (
    <Paper p="md" h="100%">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fz={26} fw={700} lh={1.3}>
        {value}
      </Text>
      {change}
      {children}
      {hint && (
        <Text component="div" size="sm" c="dimmed" mt={4}>
          {hint}
        </Text>
      )}
    </Paper>
  )
  return onClick ? (
    <UnstyledButton onClick={onClick} h="100%" w="100%">
      {body}
    </UnstyledButton>
  ) : (
    body
  )
}

/** Share of memberships renewed: brand blue on a lighter blue track. */
function Meter({ value, label }: { value: number; label: string }) {
  return <Progress value={value} color="brand.6" bg="brand.1" size="sm" mt={8} aria-label={label} />
}

function Tiles({ report, checkedInToday }: { report: DashboardReport; checkedInToday: number }) {
  const navigate = useNavigate()
  const { months, previous } = report
  const now = months[months.length - 1]
  const before = months[months.length - 2]
  const monthOnly = dayjs(`${now.month}-01`).format('MMMM')
  const vs = now.partial
    ? previous.from === previous.to
      ? `vs ${dayjs(previous.from).format('D MMM')}`
      : `vs ${dayjs(previous.from).format('D')}–${dayjs(previous.to).format('D MMM')}`
    : `vs ${dayjs(previous.from).format('MMMM')}`
  const registrations = now.newSignUps + now.renewals
  const methods = PAYMENT_TYPES.filter((t) => report.byPaymentType[t] > 0)
  const rate = now.ending ? percent(now.renewed, now.ending) : null

  return (
    <SimpleGrid cols={4}>
      <Stat
        label="Income"
        value={<Money value={now.income} />}
        change={previous.income > 0 && <Change by={percent(now.income - previous.income, previous.income)} unit="%" text={vs} />}
        hint={
          methods.length
            ? methods.map((t) => (
                <div key={t}>
                  {PAYMENT_TYPE_LABELS[t]} {lkr(report.byPaymentType[t])}
                </div>
              ))
            : 'No payments yet'
        }
      />
      <Stat
        label="Active members"
        value={now.activeMembers.toLocaleString()}
        change={
          <Change by={now.activeMembers - before.activeMembers} text={`since ${dayjs(before.through).format('D MMM')}`} />
        }
        hint={now.partial ? `${checkedInToday} checked in today` : `On ${formatDate(now.through)}`}
      />
      <Stat
        label="Registrations"
        value={registrations.toLocaleString()}
        change={<Change by={registrations - previous.newSignUps - previous.renewals} text={vs} />}
        hint={`${now.newSignUps} new · ${now.renewals} renewals`}
      />
      {now.partial ? (
        <Stat
          label="To renew this month"
          value={report.toRenew}
          hint={`${now.renewed} of ${now.ending} ending this month renewed so far`}
          onClick={() => navigate('/expiring')}
        >
          <Meter value={rate ?? 0} label="Renewed so far" />
        </Stat>
      ) : (
        <Stat
          label="Renewed"
          value={rate === null ? '–' : `${rate}%`}
          hint={
            now.ending
              ? `${now.renewed} of ${now.ending} memberships ending in ${monthOnly}`
              : `No memberships ended in ${monthOnly}`
          }
        >
          <Meter value={rate ?? 0} label="Renewed" />
        </Stat>
      )}
    </SimpleGrid>
  )
}

/** A tooltip line: a short stroke of the series colour, the value, then what it is. */
function KeyRow({ color, value, label }: { color: string; value: ReactNode; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={10} h={3} style={{ borderRadius: 2, background: color }} />
      <Text size="sm" fw={700}>
        {value}
      </Text>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}

function Charts({ months }: { months: MonthFigures[] }) {
  const now = months[months.length - 1]
  const finished = months.filter((m) => !m.partial)
  const trading = finished.filter((m) => m.income > 0)
  const total = (pick: (m: MonthFigures) => number, list = months) => list.reduce((s, m) => s + pick(m), 0)
  const averageIncome = trading.length ? total((m) => m.income, trading) / trading.length : 0
  const ended = total((m) => m.ending, finished)
  // A month in progress has no rate yet: most of its memberships haven't ended.
  const rates = months.map((m) => ({ ...m, rate: m.partial || !m.ending ? null : percent(m.renewed, m.ending) }))
  const lastRate = rates[rates.length - 1].rate
  const [blue, orange] = SERIES_COLORS

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <ChartCard
        title="Income"
        subtitle={`${shortMoney(total((m) => m.income))} in 12 months · about ${shortMoney(averageIncome)} a month`}
      >
        <MonthColumns
          months={months}
          series={[{ key: 'income', color: blue }]}
          label={compactNumber(now.income)}
          axisFormat={compactNumber}
          details={(m) => (
            <>
              <Text fw={700}>{lkr(m.income)}</Text>
              {m.store > 0 && (
                <Text size="xs" c="dimmed">
                  Memberships {lkr(m.memberships)} · store {lkr(m.store)}
                </Text>
              )}
            </>
          )}
        />
      </ChartCard>
      <ChartCard title="Active members" subtitle="Counted at the end of each month">
        <MonthLine
          months={months}
          dataKey="activeMembers"
          color={blue}
          label={now.activeMembers.toLocaleString()}
          axisFormat={(v) => v.toLocaleString()}
          details={(m) => (
            <Text size="sm">
              <b>{m.activeMembers}</b> on {formatDate(m.through)}
            </Text>
          )}
        />
      </ChartCard>
      <ChartCard
        title="New sign-ups and renewals"
        legend={[
          { color: blue, label: `New sign-ups · ${total((m) => m.newSignUps)}` },
          { color: orange, label: `Renewals · ${total((m) => m.renewals)}` }
        ]}
      >
        <MonthColumns
          months={months}
          series={[
            { key: 'newSignUps', color: blue },
            { key: 'renewals', color: orange }
          ]}
          label={String(now.newSignUps + now.renewals)}
          axisFormat={String}
          details={(m) => (
            <>
              <KeyRow color={blue} value={m.newSignUps} label="new sign-ups" />
              <KeyRow color={orange} value={m.renewals} label="renewals" />
              <Text size="xs" c="dimmed">
                Registrations starting this month
              </Text>
            </>
          )}
        />
      </ChartCard>
      <ChartCard
        title="Renewal rate"
        subtitle={
          ended
            ? `On average ${percent(total((m) => m.renewed, finished), ended)}% of memberships are renewed`
            : 'Memberships renewed, by the month they ended'
        }
      >
        <MonthColumns
          months={rates}
          series={[{ key: 'rate', color: blue }]}
          label={lastRate === null ? '' : `${lastRate}%`}
          axisFormat={(v) => `${v}%`}
          ticks={[0, 25, 50, 75, 100]}
          details={(m) =>
            m.partial ? (
              <Text size="sm">
                <b>{m.renewed}</b> of {m.ending} ending this month renewed so far
              </Text>
            ) : m.ending ? (
              <>
                <Text fw={700}>{m.rate}% renewed</Text>
                <Text size="xs" c="dimmed">
                  {m.renewed} of {m.ending} memberships that ended this month
                </Text>
              </>
            ) : (
              <Text size="sm">No memberships ended</Text>
            )
          }
        />
      </ChartCard>
    </SimpleGrid>
  )
}

/** The same figures as the charts, as numbers. */
function MonthsTable({ months }: { months: MonthFigures[] }) {
  const withStore = months.some((m) => m.store > 0)
  return (
    <Paper p="md">
      <Table.ScrollContainer minWidth={640}>
        <Table verticalSpacing={6} highlightOnHover style={{ fontVariantNumeric: 'tabular-nums' }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Month</Table.Th>
              <Table.Th ta="right">Income</Table.Th>
              {withStore && <Table.Th ta="right">of which store</Table.Th>}
              <Table.Th ta="right">Active members</Table.Th>
              <Table.Th ta="right">New sign-ups</Table.Th>
              <Table.Th ta="right">Renewals</Table.Th>
              <Table.Th ta="right">Ending</Table.Th>
              <Table.Th ta="right">Renewed</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...months].reverse().map((m) => (
              <Table.Tr key={m.month}>
                <Table.Td>{monthName(m)}</Table.Td>
                <Table.Td ta="right">{lkr(m.income)}</Table.Td>
                {withStore && <Table.Td ta="right">{lkr(m.store)}</Table.Td>}
                <Table.Td ta="right">{m.activeMembers}</Table.Td>
                <Table.Td ta="right">{m.newSignUps}</Table.Td>
                <Table.Td ta="right">{m.renewals}</Table.Td>
                <Table.Td ta="right">{m.ending}</Table.Td>
                <Table.Td ta="right">
                  {m.partial ? `${m.renewed} so far` : m.ending ? `${m.renewed} (${percent(m.renewed, m.ending)}%)` : '–'}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}

function ByPlan({ report }: { report: DashboardReport }) {
  const now = report.months[report.months.length - 1]
  return (
    <Paper p="md">
      <Title order={4}>Registrations by plan</Title>
      <Text size="sm" c="dimmed" mb="sm">
        {monthName(now)}
      </Text>
      {report.byPlan.length === 0 ? (
        <Text size="sm" c="dimmed">
          No registrations started in this month.
        </Text>
      ) : (
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Plan</Table.Th>
              <Table.Th ta="right">Count</Table.Th>
              <Table.Th ta="right">Value</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.byPlan.map((p) => (
              <Table.Tr key={p.membershipTypeId}>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td ta="right">{p.count}</Table.Td>
                <Table.Td ta="right">{lkr(p.amount)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {report.joiningFees > 0 && (
        <Text size="sm" c="dimmed" mt="sm">
          Values include {lkr(report.joiningFees)} in joining fees.
        </Text>
      )}
    </Paper>
  )
}

function ExpiringSoon() {
  const navigate = useNavigate()
  const { openMember } = useMemberDrawer()
  const today = todayIso()
  const { data = [] } = useQuery({
    queryKey: ['expiring', today, 'soon'],
    queryFn: () => api.registrations.expiring({ from: today, to: addDays(today, 14) })
  })
  const due = data.filter((r) => !r.renewed && !r.dismissedAt).sort((a, b) => a.endDate.localeCompare(b.endDate))

  return (
    <Paper p="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>Ending in the next 14 days</Title>
        <Button variant="subtle" size="xs" onClick={() => navigate('/expiring')}>
          See all
        </Button>
      </Group>
      {due.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nobody’s membership ends in the next two weeks.
        </Text>
      ) : (
        <Table verticalSpacing={6}>
          <Table.Tbody>
            {due.slice(0, 8).map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  {r.members.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 && ', '}
                      <button className="link-button" onClick={() => openMember(m.id)}>
                        {fullName(m)}
                      </button>
                    </span>
                  ))}
                  <Text size="xs" c="dimmed">
                    {r.membershipTypeName} · {r.members[0]?.mobileNumber}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{formatDate(r.endDate)}</Text>
                  <Text size="xs" c="orange.8">
                    {relativeDays(r.endDate)}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Button size="xs" variant="light" onClick={() => navigate(`/registrations/new?renew=${r.id}`)}>
                    Renew
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  )
}

export function Dashboard() {
  const today = todayIso()
  const thisMonth = today.slice(0, 7)
  const [params, setParams] = useSearchParams()
  const chosen = params.get('month')
  const month = chosen && /^\d{4}-\d{2}$/.test(chosen) && chosen < thisMonth ? chosen : thisMonth
  const setMonth = (m: string) => setParams(m >= thisMonth ? {} : { month: m }, { replace: true })
  const [view, setView] = useState<'charts' | 'table'>('charts')

  const { data: report, isPlaceholderData } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.reports.dashboard(month),
    placeholderData: keepPreviousData
  })
  const checkedInToday = useQuery({
    queryKey: ['visits', today],
    queryFn: () => api.visits.list({ from: today, to: today })
  })
  const months = report?.months

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={months ? `Figures for ${monthName(months[months.length - 1])}` : ' '}
        actions={
          <Group gap={6} wrap="nowrap">
            <ActionIcon variant="default" size={36} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <IconChevronLeft size={18} />
            </ActionIcon>
            <MonthPickerInput
              aria-label="Month"
              value={`${month}-01`}
              onChange={(v) => v && setMonth(v.slice(0, 7))}
              maxDate={today}
              valueFormat="MMMM YYYY"
              w={160}
            />
            <ActionIcon
              variant="default"
              size={36}
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <IconChevronRight size={18} />
            </ActionIcon>
          </Group>
        }
      />

      {!report || !months ? (
        <Stack gap="lg">
          <SimpleGrid cols={4}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={130} radius="md" />
            ))}
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {[0, 1].map((i) => (
              <Skeleton key={i} h={300} radius="md" />
            ))}
          </SimpleGrid>
        </Stack>
      ) : (
        <Stack gap="lg" style={{ opacity: isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <Tiles report={report} checkedInToday={checkedInToday.data?.length ?? 0} />

          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                12 months: {dayjs(`${months[0].month}-01`).format('MMM YYYY')} –{' '}
                {dayjs(`${months[months.length - 1].month}-01`).format('MMM YYYY')}
              </Text>
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as 'charts' | 'table')}
                data={[
                  { value: 'charts', label: 'Charts' },
                  { value: 'table', label: 'Table' }
                ]}
              />
            </Group>
            {view === 'charts' ? <Charts months={months} /> : <MonthsTable months={months} />}
          </Stack>

          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <ByPlan report={report} />
            <ExpiringSoon />
          </SimpleGrid>
        </Stack>
      )}
    </>
  )
}

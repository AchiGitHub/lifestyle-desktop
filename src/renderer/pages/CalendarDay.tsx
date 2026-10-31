import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Birthday, PtDay, PtRegistration } from '@shared/api'
import { addDays, todayIso } from '@shared/dates'
import { AppTable } from '../components/AppTable'
import { ClassModal, DayClasses, type ClassEdit } from '../components/classes'
import { useMemberDrawer } from '../components/MemberDrawer'
import { PageHeader } from '../components/PageHeader'
import { PtDayModal, type PtDayEdit } from '../components/ptDays'
import { RegistrationTable } from '../components/RegistrationTable'
import { PtActions } from '../components/training'
import { api, useAction } from '../lib/api'
import { classTimes, lkr, relativeDays } from '../lib/format'
import { VisitsTable } from './CheckIns'
import { FollowUpActions } from './dismiss'
import { PaymentsTable } from './Payments'

function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs" align="baseline">
          <Title order={4}>{title}</Title>
          {note && (
            <Text size="sm" c="dimmed">
              {note}
            </Text>
          )}
        </Group>
        {action}
      </Group>
      {children}
    </Stack>
  )
}

function MemberButton({ id, name }: { id: string; name: string }) {
  const { openMember } = useMemberDrawer()
  return (
    <button className="link-button" onClick={() => openMember(id)}>
      {name}
    </button>
  )
}

function PtDayStatus({ day }: { day: PtDay }) {
  if (day.came) {
    return (
      <Badge variant="light" color="teal">
        Came
      </Badge>
    )
  }
  if (day.date >= todayIso()) return null
  return (
    <Badge variant="light" color="orange">
      Missed
    </Badge>
  )
}

/** The day's planned sessions, each changed by itself. A check-in is what uses one up. */
function PtDaysTable({ days }: { days: PtDay[] }) {
  const [editing, setEditing] = useState<PtDayEdit | null>(null)
  const remove = useAction((id: string) => api.personalTraining.deleteDay(id), { success: 'Day removed' })
  return (
    <>
      <AppTable<PtDay>
        records={days}
        sort={{ columnAccessor: 'startTime', direction: 'asc' }}
        columns={[
          { accessor: 'startTime', title: 'Time', sortable: true, render: (d) => classTimes(d) },
          { accessor: 'memberName', title: 'Member', sortable: true, render: (d) => <MemberButton id={d.memberId} name={d.memberName} /> },
          { accessor: 'trainerName', title: 'Trainer', sortable: true },
          { accessor: 'packageName', title: 'Session type' },
          { accessor: 'came', title: '', render: (d) => <PtDayStatus day={d} /> },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            width: 90,
            render: (d) =>
              !d.came && (
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <ActionIcon variant="subtle" color="gray" aria-label="Change this day" onClick={() => setEditing({ kind: 'day', day: d })}>
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label="Remove this day" onClick={() => remove.mutate([d.id])}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              )
          }
        ]}
      />
      <PtDayModal edit={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/** Everything for one date, using the same tables as the pages they come from. */
export function CalendarDayPage({ date }: { date: string }) {
  const [, setParams] = useSearchParams()
  const [adding, setAdding] = useState<ClassEdit | null>(null)
  const [addingPt, setAddingPt] = useState<PtDayEdit | null>(null)
  const range = { from: date, to: date }
  const open = (next: string) => setParams({ month: next.slice(0, 7), day: next }, { replace: true })
  const past = date < todayIso()

  const { data: days } = useQuery({ queryKey: ['calendar', date, date], queryFn: () => api.calendar.days(range) })
  const ending = useQuery({ queryKey: ['expiring', date, date], queryFn: () => api.registrations.expiring(range) })
  const starting = useQuery({ queryKey: ['starting', date], queryFn: () => api.registrations.starting(range) })
  const payments = useQuery({
    queryKey: ['payments', date, date, [], null],
    queryFn: () => api.payments.list({ ...range, categories: [], paymentType: null })
  })
  const visits = useQuery({ queryKey: ['visits', date], queryFn: () => api.visits.list(range) })
  const training = useQuery({ queryKey: ['personalTraining'], queryFn: () => api.personalTraining.list() })
  const birthdays = useQuery({ queryKey: ['birthdays', date], queryFn: () => api.calendar.birthdays(date) })

  const classes = days?.[0]?.classes ?? []
  const planned = days?.[0]?.ptDays ?? []
  const due = (ending.data ?? []).filter((r) => !r.renewed && !r.dismissedAt)
  const paid = payments.data ?? []
  const checkIns = visits.data ?? []
  const started = starting.data ?? []
  const ptEnding = (training.data ?? []).filter((p) => p.endDate === date && p.left > 0)
  const people = birthdays.data ?? []

  return (
    <>
      <PageHeader
        title={dayjs(date).format('dddd D MMMM YYYY')}
        description={relativeDays(date)}
        actions={
          <>
            <Button
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => setParams({ month: date.slice(0, 7) })}
            >
              {dayjs(date).format('MMMM')}
            </Button>
            <Group gap={6} wrap="nowrap">
              <ActionIcon variant="default" size={36} aria-label="Previous day" onClick={() => open(addDays(date, -1))}>
                <IconChevronLeft size={18} />
              </ActionIcon>
              <ActionIcon variant="default" size={36} aria-label="Next day" onClick={() => open(addDays(date, 1))}>
                <IconChevronRight size={18} />
              </ActionIcon>
            </Group>
          </>
        }
      />
      <Stack gap="lg">
        <Section
          title="Classes"
          action={
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ kind: 'new', date })}>
              Add class
            </Button>
          }
        >
          {classes.length > 0 ? (
            <DayClasses classes={classes} />
          ) : (
            <Paper p="md">
              <Text size="sm" c="dimmed">
                No classes on this day.
              </Text>
            </Paper>
          )}
        </Section>

        <Section
          title="Personal training"
          action={
            !past && (
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setAddingPt({ kind: 'new', date })}>
                Add day
              </Button>
            )
          }
        >
          {planned.length > 0 ? (
            <PtDaysTable days={planned} />
          ) : (
            <Paper p="md">
              <Text size="sm" c="dimmed">
                No personal training planned on this day.
              </Text>
            </Paper>
          )}
        </Section>

        {due.length > 0 && (
          <Section title={past ? 'Not renewed' : 'Renewals due'} note={`${due.length} ending this day`}>
            <RegistrationTable
              records={due}
              showMoney={false}
              defaultSort="endDate"
              actions={(r) => <FollowUpActions registration={r} />}
            />
          </Section>
        )}

        {paid.length > 0 && (
          <Section title="Payments" note={`${lkr(paid.reduce((sum, p) => sum + p.amount, 0))} taken`}>
            <PaymentsTable records={paid} showRecordedBy />
          </Section>
        )}

        {checkIns.length > 0 && (
          <Section title="Check-ins" note={`${checkIns.length} came in`}>
            <VisitsTable records={checkIns} />
          </Section>
        )}

        {started.length > 0 && (
          <Section title="Sign-ups and renewals" note="Memberships starting this day">
            <RegistrationTable records={started} />
          </Section>
        )}

        {ptEnding.length > 0 && (
          <Section title="Personal training ending" note="Sessions left after this day can’t be used">
            <AppTable<PtRegistration>
              records={ptEnding}
              columns={[
                { accessor: 'memberName', title: 'Member', render: (p) => <MemberButton id={p.memberId} name={p.memberName} /> },
                { accessor: 'trainerName', title: 'Trainer' },
                { accessor: 'packageName', title: 'Session type' },
                { accessor: 'left', title: 'Sessions', render: (p) => `${p.left} of ${p.sessions} left` },
                { accessor: 'actions', title: '', textAlign: 'right', width: 50, render: (p) => <PtActions pt={p} /> }
              ]}
            />
          </Section>
        )}

        {people.length > 0 && (
          <Section title="Birthdays">
            <AppTable<Birthday>
              records={people}
              columns={[
                { accessor: 'name', title: 'Member', render: (b) => <MemberButton id={b.id} name={b.name} /> },
                { accessor: 'mobileNumber', title: 'Mobile', render: (b) => b.mobileNumber ?? '—' },
                { accessor: 'turns', title: 'Turns', textAlign: 'right' }
              ]}
            />
          </Section>
        )}
      </Stack>
      <ClassModal edit={adding} onClose={() => setAdding(null)} />
      <PtDayModal edit={addingPt} onClose={() => setAddingPt(null)} />
    </>
  )
}

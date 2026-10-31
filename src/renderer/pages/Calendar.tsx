import { ActionIcon, Button, Chip, Group, Paper, Skeleton, Stack, Tabs, Text, UnstyledButton } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { useLocalStorage } from '@mantine/hooks'
import { IconChevronLeft, IconChevronRight, IconPlus } from '@tabler/icons-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CalendarDay } from '@shared/api'
import { monthGrid, shiftMonth, todayIso } from '@shared/dates'
import { WEEKDAYS, WEEKDAY_LABELS } from '@shared/enums'
import { ClassModal, ClassTypes, WeeklyClasses, type ClassEdit } from '../components/classes'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { compactNumber, formatClock } from '../lib/format'
import { CalendarDayPage } from './CalendarDay'

const LAYERS = [
  { value: 'classes', label: 'Classes' },
  { value: 'renewals', label: 'Renewals' },
  { value: 'takings', label: 'Takings' },
  { value: 'checkIns', label: 'Check-ins' },
  { value: 'signUps', label: 'Sign-ups' },
  { value: 'training', label: 'Personal training' },
  { value: 'birthdays', label: 'Birthdays' }
]
// Birthdays start hidden: there are several most days, and they'd crowd out the rest.
const DEFAULT_LAYERS = LAYERS.map((l) => l.value).filter((v) => v !== 'birthdays')

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A class or planned session: its time and what it is, in its colour. */
function TimedChip({ time, label, color, cancelled }: { time: string; label: string; color: string; cancelled?: boolean }) {
  return (
    <span
      className="calendar-class"
      data-cancelled={cancelled || undefined}
      style={{ background: `var(--mantine-color-${color}-light)`, color: `var(--mantine-color-${color}-light-color)` }}
    >
      {formatClock(time)} {label}
    </span>
  )
}

function Line({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <Text span className="calendar-line" c={color}>
      {children}
    </Text>
  )
}

function DayCell({ day, month, show, onOpen }: { day: CalendarDay; month: string; show: Set<string>; onOpen: () => void }) {
  const today = todayIso()
  const started = [day.newSignUps > 0 && `${day.newSignUps} new`, day.renewals > 0 && counted(day.renewals, 'renewal')]
  return (
    <UnstyledButton
      className="calendar-day"
      data-outside={!day.date.startsWith(month) || undefined}
      data-today={day.date === today || undefined}
      aria-label={dayjs(day.date).format('dddd D MMMM YYYY')}
      onClick={onOpen}
    >
      <span className="calendar-date">{dayjs(day.date).format('D')}</span>
      {show.has('classes') &&
        day.classes.map((c) => (
          <TimedChip key={c.id} time={c.startTime} label={c.className} color={c.color} cancelled={c.cancelled} />
        ))}
      {show.has('training') &&
        day.ptDays.map((d) => <TimedChip key={d.id} time={d.startTime} label={d.memberName} color="pink" />)}
      {show.has('renewals') && day.due > 0 && (
        <Line color={day.date < today ? 'var(--app-red-text)' : 'var(--app-orange-text)'}>
          {day.due} {day.date < today ? 'not renewed' : 'due'}
        </Line>
      )}
      {show.has('takings') && day.takings > 0 && <Line>Rs. {compactNumber(day.takings)}</Line>}
      {show.has('checkIns') && day.checkIns > 0 && <Line color="dimmed">{counted(day.checkIns, 'check-in')}</Line>}
      {show.has('signUps') && started.some(Boolean) && <Line color="dimmed">{started.filter(Boolean).join(' · ')}</Line>}
      {show.has('training') && day.ptEnding > 0 && <Line color="pink">{day.ptEnding} PT ending</Line>}
      {show.has('birthdays') && day.birthdays > 0 && <Line color="dimmed">{counted(day.birthdays, 'birthday')}</Line>}
    </UnstyledButton>
  )
}

function Month() {
  const today = todayIso()
  const [params, setParams] = useSearchParams()
  const chosen = params.get('month')
  const month = chosen && /^\d{4}-\d{2}$/.test(chosen) ? chosen : today.slice(0, 7)
  const setMonth = (m: string) => setParams({ month: m }, { replace: true })
  const [layers, setLayers] = useLocalStorage<string[]>({ key: 'calendar-layers', defaultValue: DEFAULT_LAYERS })

  const grid = monthGrid(month)
  const range = { from: grid[0], to: grid[grid.length - 1] }
  const { data: days } = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: () => api.calendar.days(range),
    placeholderData: keepPreviousData
  })
  const show = new Set(layers)

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Group gap={6} wrap="nowrap">
          <ActionIcon variant="default" size={36} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <IconChevronLeft size={18} />
          </ActionIcon>
          <MonthPickerInput
            aria-label="Month"
            value={`${month}-01`}
            onChange={(v) => v && setMonth(v.slice(0, 7))}
            valueFormat="MMMM YYYY"
            w={160}
          />
          <ActionIcon variant="default" size={36} aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <IconChevronRight size={18} />
          </ActionIcon>
          <Button variant="default" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
        </Group>
        <Chip.Group multiple value={layers} onChange={setLayers}>
          <Group gap={6}>
            {LAYERS.map((l) => (
              <Chip key={l.value} value={l.value} size="xs">
                {l.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Group>
      {days ? (
        <Paper style={{ overflow: 'hidden' }}>
          <div className="calendar-grid">
            {WEEKDAYS.map((d) => (
              <Text key={d} className="calendar-weekday" size="xs" c="dimmed" tt="uppercase" fw={700}>
                {WEEKDAY_LABELS[d]}
              </Text>
            ))}
            {days.map((day) => (
              <DayCell
                key={day.date}
                day={day}
                month={month}
                show={show}
                onOpen={() => setParams({ month, day: day.date })}
              />
            ))}
          </div>
        </Paper>
      ) : (
        <Skeleton h={560} radius="md" />
      )}
    </Stack>
  )
}

export function Calendar() {
  const [params] = useSearchParams()
  const [adding, setAdding] = useState<ClassEdit | null>(null)
  const day = params.get('day')
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return <CalendarDayPage date={day} />

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Classes, and what’s due or happened on each day. Click a day to see all of it."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding({ kind: 'new' })}>
            Add class
          </Button>
        }
      />
      <Tabs defaultValue="month" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="month">Month</Tabs.Tab>
          <Tabs.Tab value="weekly">Weekly classes</Tabs.Tab>
          <Tabs.Tab value="types">Class types</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="month">
          <Month />
        </Tabs.Panel>
        <Tabs.Panel value="weekly">
          <WeeklyClasses />
        </Tabs.Panel>
        <Tabs.Panel value="types">
          <ClassTypes />
        </Tabs.Panel>
      </Tabs>
      <ClassModal edit={adding} onClose={() => setAdding(null)} />
    </>
  )
}

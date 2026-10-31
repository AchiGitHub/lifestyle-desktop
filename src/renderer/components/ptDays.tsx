import { ActionIcon, Button, Center, Group, Loader, Modal, NumberInput, Paper, ScrollArea, Select, Stack, Text } from '@mantine/core'
import { DatePicker, DatePickerInput, TimeInput } from '@mantine/dates'
import { schemaResolver, useForm } from '@mantine/form'
import { IconRepeat, IconX } from '@tabler/icons-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import type { PtDay, PtRegistration } from '@shared/api'
import { todayIso, weeklyDates } from '@shared/dates'
import { ptDayAddInput, type PtDayAddInput, type PtDayInput } from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { formatClock, formatDate } from '../lib/format'
import { WeekdayPicker } from './classes'

const hasTime = (day: PtDayInput) => /^\d{2}:\d{2}/.test(day.startTime ?? '')

/** What else the package's trainer has at those times. It's only a warning: the owner decides. */
function useClashes(ptRegistrationId: string, days: PtDayInput[]) {
  const timed = days.filter(hasTime)
  const { data = [] } = useQuery({
    queryKey: ['ptDayClashes', ptRegistrationId, timed],
    queryFn: () => api.personalTraining.dayClashes({ ptRegistrationId, days: timed }),
    enabled: Boolean(ptRegistrationId) && timed.length > 0,
    placeholderData: keepPreviousData
  })
  return (date: string) =>
    data
      .filter((c) => c.date === date)
      .map((c) => `Trainer also has ${c.name} at ${formatClock(c.startTime)}`)
      .join(' · ')
}

function ClashNote({ text }: { text: string }) {
  if (!text) return null
  return (
    <Text size="xs" c="var(--app-orange-text)">
      {text}
    </Text>
  )
}

function DaysEditor({ pt, saved, onClose }: { pt: PtRegistration; saved: PtDay[]; onClose: () => void }) {
  const today = todayIso()
  const first = pt.startDate > today ? pt.startDate : today
  const had = new Set(saved.filter((d) => d.came).map((d) => d.date))
  const [days, setDays] = useState<PtDayInput[]>(
    saved.filter((d) => !d.came).map(({ date, startTime, minutes }) => ({ date, startTime, minutes }))
  )
  const [time, setTime] = useState(days[0]?.startTime ?? '')
  const [length, setLength] = useState<number>(days[0]?.minutes ?? 60)
  const [repeat, setRepeat] = useState<number[]>([])
  const save = useAction((list: PtDayInput[]) => api.personalTraining.setDays(pt.id, list), { success: 'Session days saved' })
  const clashWith = useClashes(pt.id, days)

  const choose = (dates: string[]) =>
    setDays(
      dates
        .map((date) => days.find((d) => d.date === date) ?? { date, startTime: time, minutes: length })
        .sort((a, b) => a.date.localeCompare(b.date))
    )
  const fill = () => {
    const chosen = days.map((d) => d.date)
    const free = weeklyDates(first, pt.endDate, repeat).filter((d) => !chosen.includes(d) && !had.has(d))
    choose([...chosen, ...free.slice(0, Math.max(0, pt.left - chosen.length))])
  }
  const changeDay = (date: string, patch: Partial<PtDayInput>) =>
    setDays(days.map((d) => (d.date === date ? { ...d, ...patch } : d)))
  // The usual time and length follow through to days still on the old one; days set by hand keep theirs.
  const changeTime = (next: string) => {
    setDays(days.map((d) => (d.startTime === time || !d.startTime ? { ...d, startTime: next } : d)))
    setTime(next)
  }
  const changeLength = (next: number) => {
    setDays(days.map((d) => (d.minutes === length ? { ...d, minutes: next } : d)))
    setLength(next)
  }

  const extra = days.length - pt.left
  const problem =
    extra > 0
      ? `That’s ${days.length} days for ${pt.left} sessions left. Remove ${extra}.`
      : days.some((d) => !hasTime(d))
        ? 'Choose a time for every day.'
        : null

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {pt.memberName} with {pt.trainerName} · {pt.left} of {pt.sessions} sessions left · use by {formatDate(pt.endDate)}
      </Text>
      <Group grow align="flex-start">
        <TimeInput label="Usual time" value={time} onChange={(e) => changeTime(e.currentTarget.value)} />
        <NumberInput
          label="Length"
          suffix=" min"
          min={5}
          max={480}
          value={length}
          onChange={(n) => typeof n === 'number' && changeLength(n)}
        />
      </Group>
      <Group align="flex-start" wrap="nowrap" gap="lg">
        <DatePicker
          type="multiple"
          value={days.map((d) => d.date)}
          onChange={choose}
          minDate={first}
          maxDate={pt.endDate}
          excludeDate={(d) => had.has(dayjs(d).format('YYYY-MM-DD'))}
          defaultDate={days[0]?.date ?? first}
          aria-label="Choose session days"
        />
        <Stack gap={6} flex={1} miw={0}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" fw={600}>
              {days.length} of {pt.left} sessions have a day
            </Text>
            {days.length > 0 && (
              <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setDays([])}>
                Clear all
              </Button>
            )}
          </Group>
          {days.length === 0 ? (
            <Text size="sm" c="dimmed">
              Click the days on the calendar.
            </Text>
          ) : (
            <ScrollArea.Autosize mah={220} type="auto" offsetScrollbars>
              <Stack gap={6}>
                {days.map((d) => (
                  <div key={d.date}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" w={92}>
                        {dayjs(d.date).format('ddd D MMM')}
                      </Text>
                      <TimeInput
                        size="xs"
                        w={112}
                        aria-label={`Time on ${formatDate(d.date)}`}
                        value={d.startTime}
                        onChange={(e) => changeDay(d.date, { startTime: e.currentTarget.value })}
                      />
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Remove ${formatDate(d.date)}`}
                        onClick={() => setDays(days.filter((x) => x.date !== d.date))}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Group>
                    <ClashNote text={clashWith(d.date)} />
                  </div>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </Group>
      <Paper p="sm" bg="var(--app-muted-bg)">
        <WeekdayPicker label="Or repeat every week" value={repeat} onChange={setRepeat} />
        <Group gap="sm" mt="xs" wrap="nowrap">
          <Button size="xs" variant="light" leftSection={<IconRepeat size={14} />} disabled={repeat.length === 0} onClick={fill}>
            Fill dates
          </Button>
          <Text size="xs" c="dimmed">
            Adds those days up to the sessions left. You can still change any of them.
          </Text>
        </Group>
      </Paper>
      {problem && (
        <Text size="sm" c="var(--app-red-text)">
          {problem}
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={problem !== null} loading={save.isPending} onClick={() => save.mutate([days], { onSuccess: onClose })}>
          Save days
        </Button>
      </Group>
    </Stack>
  )
}

function DaysLoader({ pt, onClose }: { pt: PtRegistration; onClose: () => void }) {
  // Not kept after closing: the form starts from what's saved each time it opens.
  const { data } = useQuery({ queryKey: ['ptDays', pt.id], queryFn: () => api.personalTraining.days(pt.id), gcTime: 0 })
  if (!data) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }
  return <DaysEditor pt={pt} saved={data} onClose={onClose} />
}

/** Choosing a package's days: by hand, with a repeat to fill them in. */
export function PtDaysModal({ pt, onClose }: { pt: PtRegistration | null; onClose: () => void }) {
  return (
    <Modal opened={pt !== null} onClose={onClose} title="Session days" size="lg">
      {pt && <DaysLoader pt={pt} onClose={onClose} />}
    </Modal>
  )
}

/** One day from the calendar: a new one on a date, or one being changed. */
export type PtDayEdit = { kind: 'new'; date: string } | { kind: 'day'; day: PtDay }

function PtDayForm({ edit, onClose }: { edit: PtDayEdit; onClose: () => void }) {
  const { data: packages = [] } = useQuery({ queryKey: ['personalTraining'], queryFn: () => api.personalTraining.list() })
  const form = useForm<PtDayAddInput>({
    initialValues:
      edit.kind === 'day'
        ? {
            ptRegistrationId: edit.day.ptRegistrationId,
            date: edit.day.date,
            startTime: edit.day.startTime,
            minutes: edit.day.minutes
          }
        : ({ ptRegistrationId: '', date: edit.date, startTime: '', minutes: 60 } as PtDayAddInput),
    validate: schemaResolver(ptDayAddInput, { sync: true })
  })
  const save = useAction(
    (v: PtDayAddInput) => (edit.kind === 'day' ? api.personalTraining.updateDay(edit.day.id, v) : api.personalTraining.addDay(v)),
    { success: edit.kind === 'day' ? 'Day changed' : 'Day added' }
  )
  const { ptRegistrationId, date } = form.values
  const clashWith = useClashes(ptRegistrationId, [form.values])
  const choices = packages.filter((p) => p.left > 0 && p.startDate <= date && p.endDate >= date)
  const chosen = packages.find((p) => p.id === ptRegistrationId)

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        {edit.kind === 'new' ? (
          <Select
            label="Package"
            withAsterisk
            searchable
            data={choices.map((p) => ({ value: p.id, label: `${p.memberName} · ${p.packageName} · ${p.left} left` }))}
            nothingFoundMessage="No package with sessions left on this day"
            {...form.getInputProps('ptRegistrationId')}
          />
        ) : (
          <Text size="sm" c="dimmed">
            {edit.day.memberName} with {edit.day.trainerName} · {edit.day.packageName}
          </Text>
        )}
        <DatePickerInput
          label="Date"
          withAsterisk
          valueFormat="ddd D MMM YYYY"
          minDate={todayIso()}
          maxDate={chosen?.endDate}
          {...form.getInputProps('date')}
        />
        <Group grow align="flex-start">
          <TimeInput label="Start time" withAsterisk {...form.getInputProps('startTime')} />
          <NumberInput label="Length" suffix=" min" min={5} max={480} withAsterisk {...form.getInputProps('minutes')} />
        </Group>
        <ClashNote text={clashWith(date)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {edit.kind === 'day' ? 'Save changes' : 'Add day'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function PtDayModal({ edit, onClose }: { edit: PtDayEdit | null; onClose: () => void }) {
  return (
    <Modal opened={edit !== null} onClose={onClose} title={edit?.kind === 'day' ? 'Change this day' : 'Add personal training'}>
      {edit && <PtDayForm edit={edit} onClose={onClose} />}
    </Modal>
  )
}

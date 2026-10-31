import {
  ActionIcon,
  Badge,
  Box,
  Button,
  ColorSwatch,
  Group,
  Input,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import { DatePickerInput, TimeInput } from '@mantine/dates'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { IconArchive, IconArchiveOff, IconCheck, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import type { ClassSeries, ClassSession, ClassType } from '@shared/api'
import { parseIsoDate, todayIso } from '@shared/dates'
import { CLASS_COLORS, WEEKDAYS, WEEKDAY_LABELS, type ClassColor } from '@shared/enums'
import {
  classSeriesInput,
  classSessionInput,
  classTypeInput,
  type ClassSeriesInput,
  type ClassSessionInput,
  type ClassTypeInput
} from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { classTimes, formatDate } from '../lib/format'
import { useClassSeries, useClassTypes, useTrainers } from '../lib/queries'
import { AppTable } from './AppTable'

/** What the class form is for: a new class (on a date, if chosen from one), or one being changed. */
export type ClassEdit =
  | { kind: 'new'; date?: string }
  | { kind: 'session'; session: ClassSession }
  | { kind: 'series'; series: ClassSeries }

interface ClassValues {
  repeat: boolean
  classTypeId: string | null
  startTime: string
  minutes: number | string
  trainerId: string | null
  date: string
  weekdays: number[]
  startsOn: string
  endsOn: string | null
}

function startValues(edit: ClassEdit): ClassValues {
  const today = todayIso()
  const blank = {
    repeat: false,
    classTypeId: null,
    startTime: '',
    minutes: '',
    trainerId: null,
    date: today,
    weekdays: [],
    startsOn: today,
    endsOn: null
  }
  if (edit.kind === 'series') {
    const { classTypeId, startTime, minutes, trainerId, weekdays, startsOn, endsOn } = edit.series
    return { ...blank, repeat: true, classTypeId, startTime, minutes, trainerId, weekdays, startsOn, endsOn }
  }
  if (edit.kind === 'session') {
    const { classTypeId, startTime, minutes, trainerId, date } = edit.session
    return { ...blank, classTypeId, startTime, minutes, trainerId, date }
  }
  // Most classes repeat. Chosen from a day, it's for that day unless staff say otherwise.
  const date = edit.date ?? today
  return { ...blank, repeat: !edit.date, date, startsOn: date, weekdays: edit.date ? [parseIsoDate(date).getDay()] : [] }
}

/** Days of the week as toggles, Monday first. */
export function WeekdayPicker({
  label,
  required,
  error,
  value,
  onChange
}: {
  label: string
  required?: boolean
  error?: ReactNode
  value: number[]
  onChange: (days: number[]) => void
}) {
  return (
    <Input.Wrapper label={label} withAsterisk={required} error={error}>
      <Group gap={4} grow mt={4}>
        {WEEKDAYS.map((d) => {
          const on = value.includes(d)
          return (
            <Button
              key={d}
              size="xs"
              px={0}
              variant={on ? 'filled' : 'default'}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((w) => w !== d) : [...value, d])}
            >
              {WEEKDAY_LABELS[d]}
            </Button>
          )
        })}
      </Group>
    </Input.Wrapper>
  )
}

function ClassForm({ edit, onClose }: { edit: ClassEdit; onClose: () => void }) {
  const { data: types = [] } = useClassTypes()
  const { data: trainers = [] } = useTrainers()
  const form = useForm<ClassValues>({
    initialValues: startValues(edit),
    validate: (values) => schemaResolver(values.repeat ? classSeriesInput : classSessionInput, { sync: true })(values)
  })
  const save = useAction(
    (v: ClassValues) => {
      if (edit.kind === 'series') return api.classSeries.update(edit.series.id, v as ClassSeriesInput)
      if (edit.kind === 'session') return api.classSessions.update(edit.session.id, v as ClassSessionInput)
      return v.repeat ? api.classSeries.create(v as ClassSeriesInput) : api.classSessions.create(v as ClassSessionInput)
    },
    { success: edit.kind === 'new' ? 'Class added' : 'Class updated' }
  )
  const { repeat, classTypeId, trainerId } = form.values
  const initial = form.getInitialValues()
  const pickType = (id: string | null) => {
    form.setFieldValue('classTypeId', id)
    const type = types.find((t) => t.id === id)
    if (type) form.setFieldValue('minutes', type.minutes)
  }
  const movesWeekly = edit.kind === 'session' && edit.session.seriesId !== null && form.values.date !== initial.date

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        {edit.kind === 'new' && (
          <SegmentedControl
            value={repeat ? 'weekly' : 'once'}
            onChange={(v) => form.setFieldValue('repeat', v === 'weekly')}
            data={[
              { value: 'weekly', label: 'Every week' },
              { value: 'once', label: 'One date' }
            ]}
          />
        )}
        <Select
          label="Class"
          withAsterisk
          data={types.filter((t) => !t.archived || t.id === classTypeId).map((t) => ({ value: t.id, label: t.name }))}
          allowDeselect={false}
          nothingFoundMessage="Add one on the Class types tab"
          {...form.getInputProps('classTypeId')}
          onChange={pickType}
        />
        {repeat ? (
          <WeekdayPicker
            label="Days"
            required
            error={form.errors.weekdays}
            value={form.values.weekdays}
            onChange={(days) => form.setFieldValue('weekdays', days)}
          />
        ) : (
          <DatePickerInput
            label="Date"
            withAsterisk
            valueFormat="ddd D MMM YYYY"
            description={movesWeekly ? 'The old date stays on the calendar as cancelled.' : undefined}
            {...form.getInputProps('date')}
          />
        )}
        <Group grow align="flex-start">
          <TimeInput label="Start time" withAsterisk {...form.getInputProps('startTime')} />
          <NumberInput label="Length" suffix=" min" min={5} max={480} withAsterisk {...form.getInputProps('minutes')} />
        </Group>
        <Select
          label="Instructor"
          placeholder="None yet"
          data={trainers.filter((t) => !t.archived || t.id === trainerId).map((t) => ({ value: t.id, label: t.name }))}
          clearable
          nothingFoundMessage="Add instructors in Settings → Personal trainers"
          {...form.getInputProps('trainerId')}
        />
        {repeat && (
          <Group grow align="flex-start">
            <DatePickerInput label="First day" withAsterisk valueFormat="D MMM YYYY" {...form.getInputProps('startsOn')} />
            <DatePickerInput
              label="Last day"
              placeholder="Keeps going"
              clearable
              valueFormat="D MMM YYYY"
              {...form.getInputProps('endsOn')}
            />
          </Group>
        )}
        {edit.kind === 'series' && (
          <Text size="xs" c="dimmed">
            Changes apply from today on. Earlier classes stay as they were.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {edit.kind === 'new' ? 'Add class' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

const CLASS_FORM_TITLES: Record<ClassEdit['kind'], string> = {
  new: 'Add class',
  session: 'Change this date',
  series: 'Change weekly class'
}

export function ClassModal({ edit, onClose }: { edit: ClassEdit | null; onClose: () => void }) {
  return (
    <Modal opened={edit !== null} onClose={onClose} title={edit && CLASS_FORM_TITLES[edit.kind]}>
      {edit && <ClassForm edit={edit} onClose={onClose} />}
    </Modal>
  )
}

/** The class's name with its calendar colour. */
function ClassName({ name, color }: { name: string; color: ClassColor }) {
  return (
    <Group gap={8} wrap="nowrap">
      <Box w={10} h={10} style={{ borderRadius: 2, background: `var(--mantine-color-${color}-6)`, flex: 'none' }} />
      <Text size="sm" fw={600}>
        {name}
      </Text>
    </Group>
  )
}

const instructor = (name: string | null) =>
  name ?? (
    <Text size="sm" c="dimmed">
      None yet
    </Text>
  )

/** The classes on one day, each changed or cancelled by itself. */
export function DayClasses({ classes }: { classes: ClassSession[] }) {
  const [editing, setEditing] = useState<ClassEdit | null>(null)
  const cancel = useAction((id: string, cancelled: boolean) => api.classSessions.setCancelled(id, cancelled), {
    success: 'Class updated'
  })
  const remove = useAction((id: string) => api.classSessions.delete(id), { success: 'Class deleted' })
  return (
    <>
      <AppTable<ClassSession>
        records={classes}
        sort={{ columnAccessor: 'startTime', direction: 'asc' }}
        columns={[
          { accessor: 'startTime', title: 'Time', sortable: true, render: (c) => classTimes(c) },
          { accessor: 'className', title: 'Class', sortable: true, render: (c) => <ClassName name={c.className} color={c.color} /> },
          { accessor: 'trainerName', title: 'Instructor', sortable: true, render: (c) => instructor(c.trainerName) },
          {
            accessor: 'seriesId',
            title: 'Repeats',
            render: (c) => (c.seriesId ? 'Weekly' : <Text size="sm" c="dimmed">One date</Text>)
          },
          {
            accessor: 'cancelled',
            title: '',
            render: (c) =>
              c.cancelled && (
                <Badge variant="light" color="gray">
                  Cancelled
                </Badge>
              )
          },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            render: (c) => (
              <Group gap="xs" justify="flex-end" wrap="nowrap">
                <Button size="xs" variant="subtle" color="gray" onClick={() => cancel.mutate([c.id, !c.cancelled])}>
                  {c.cancelled ? 'Restore' : 'Cancel class'}
                </Button>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Change this date"
                  onClick={() => setEditing({ kind: 'session', session: c })}
                >
                  <IconEdit size={16} />
                </ActionIcon>
                {!c.seriesId && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="Delete class"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: `Delete this ${c.className} class?`,
                        children: <Text size="sm">To show members it isn’t running, cancel it instead.</Text>,
                        labels: { confirm: 'Delete', cancel: 'Keep it' },
                        confirmProps: { color: 'red' },
                        onConfirm: () => remove.mutate([c.id])
                      })
                    }
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            )
          }
        ]}
      />
      <ClassModal edit={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/** "From 3 Nov 2026", "3 Nov 2026 – 31 Jan 2027", or that it's over. */
function SeriesDates({ series, today }: { series: ClassSeries; today: string }) {
  if (series.endsOn && series.endsOn < today) {
    return (
      <Badge variant="light" color="gray">
        Ended {formatDate(series.endsOn)}
      </Badge>
    )
  }
  return series.endsOn ? `${formatDate(series.startsOn)} – ${formatDate(series.endsOn)}` : `From ${formatDate(series.startsOn)}`
}

/** The weekly timetable: what fills the calendar. */
export function WeeklyClasses() {
  const { data = [], isPending } = useClassSeries()
  const [editing, setEditing] = useState<ClassEdit | null>(null)
  const remove = useAction((id: string) => api.classSeries.delete(id), { success: 'Weekly class stopped' })
  const today = todayIso()
  return (
    <>
      <AppTable<ClassSeries>
        records={data}
        fetching={isPending}
        sort={{ columnAccessor: 'startTime', direction: 'asc' }}
        emptyText="No weekly classes yet. Add one and it fills the calendar."
        columns={[
          { accessor: 'className', title: 'Class', sortable: true, render: (s) => <ClassName name={s.className} color={s.color} /> },
          {
            accessor: 'weekdays',
            title: 'Days',
            render: (s) =>
              WEEKDAYS.filter((d) => s.weekdays.includes(d))
                .map((d) => WEEKDAY_LABELS[d])
                .join(', ')
          },
          { accessor: 'startTime', title: 'Time', sortable: true, render: (s) => classTimes(s) },
          { accessor: 'trainerName', title: 'Instructor', sortable: true, render: (s) => instructor(s.trainerName) },
          { accessor: 'startsOn', title: 'Runs', render: (s) => <SeriesDates series={s} today={today} /> },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            width: 90,
            render: (s) => (
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <ActionIcon variant="subtle" color="gray" aria-label="Change" onClick={() => setEditing({ kind: 'series', series: s })}>
                  <IconEdit size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Stop this class"
                  onClick={() =>
                    modals.openConfirmModal({
                      title: `Stop ${s.className}?`,
                      children: (
                        <Text size="sm">
                          It comes off the calendar from today on, including any dates changed by hand. Past classes stay.
                        </Text>
                      ),
                      labels: { confirm: 'Stop class', cancel: 'Keep it' },
                      confirmProps: { color: 'red' },
                      onConfirm: () => remove.mutate([s.id])
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
      <ClassModal edit={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function ClassTypeForm({ type, onClose }: { type?: ClassType; onClose: () => void }) {
  const form = useForm<ClassTypeInput>({
    initialValues: type
      ? { name: type.name, color: type.color, minutes: type.minutes }
      : { name: '', color: 'brand', minutes: 60 },
    validate: schemaResolver(classTypeInput, { sync: true })
  })
  const save = useAction(
    (v: ClassTypeInput) => (type ? api.classTypes.update(type.id, v) : api.classTypes.create(v)),
    { success: type ? 'Class updated' : 'Class added' }
  )
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <TextInput label="Name" withAsterisk data-autofocus {...form.getInputProps('name')} />
        <NumberInput
          label="Usual length"
          description="Fills in the length of a new class."
          suffix=" min"
          min={5}
          max={480}
          {...form.getInputProps('minutes')}
        />
        <Input.Wrapper label="Colour on the calendar" error={form.errors.color}>
          <Group gap={8} mt={4}>
            {CLASS_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                component="button"
                type="button"
                color={`var(--mantine-color-${color}-6)`}
                aria-label={color}
                aria-pressed={form.values.color === color}
                c="white"
                style={{ cursor: 'pointer' }}
                onClick={() => form.setFieldValue('color', color)}
              >
                {form.values.color === color && <IconCheck size={14} />}
              </ColorSwatch>
            ))}
          </Group>
        </Input.Wrapper>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {type ? 'Save changes' : 'Add class'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

/** The kinds of class the gym runs. */
export function ClassTypes() {
  const { data = [], isPending } = useClassTypes()
  const [editing, setEditing] = useState<{ type?: ClassType } | null>(null)
  const archive = useAction((id: string, archived: boolean) => api.classTypes.setArchived(id, archived))
  const remove = useAction((id: string) => api.classTypes.delete(id), { success: 'Class deleted' })
  return (
    <Stack>
      <Group justify="flex-end">
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing({})}>
          Add class type
        </Button>
      </Group>
      <AppTable<ClassType>
        records={data}
        fetching={isPending}
        emptyText="No classes yet"
        columns={[
          {
            accessor: 'name',
            title: 'Class',
            render: (t) => (
              <Group gap="xs" wrap="nowrap">
                <ClassName name={t.name} color={t.color} />
                {t.archived && (
                  <Badge size="xs" variant="light" color="gray">
                    Archived
                  </Badge>
                )}
              </Group>
            )
          },
          { accessor: 'minutes', title: 'Usual length', render: (t) => `${t.minutes} min` },
          {
            accessor: 'actions',
            title: '',
            textAlign: 'right',
            width: 120,
            render: (t) => (
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <ActionIcon variant="subtle" color="gray" aria-label="Edit" onClick={() => setEditing({ type: t })}>
                  <IconEdit size={16} />
                </ActionIcon>
                <Tooltip label={t.archived ? 'Restore' : 'Archive: hide from new classes'} withinPortal>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={t.archived ? 'Restore' : 'Archive'}
                    onClick={() => archive.mutate([t.id, !t.archived])}
                  >
                    {t.archived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                  </ActionIcon>
                </Tooltip>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Delete"
                  onClick={() =>
                    modals.openConfirmModal({
                      title: `Delete ${t.name}?`,
                      children: <Text size="sm">Only a class that’s never been on the calendar can be deleted; otherwise archive it.</Text>,
                      labels: { confirm: 'Delete', cancel: 'Keep it' },
                      confirmProps: { color: 'red' },
                      onConfirm: () => remove.mutate([t.id])
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
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.type ? 'Edit class' : 'Add class type'}>
        {editing && <ClassTypeForm type={editing.type} onClose={() => setEditing(null)} />}
      </Modal>
    </Stack>
  )
}

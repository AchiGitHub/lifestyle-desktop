import {
  Alert,
  Button,
  Group,
  Input,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Text,
  TextInput,
  Textarea
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import type { UseFormReturnType } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconCalendar, IconUserExclamation } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Member } from '@shared/api'
import { todayIso } from '@shared/dates'
import { GENDERS, GENDER_LABELS } from '@shared/enums'
import type { MemberInput } from '@shared/schemas'
import { api } from '../lib/api'
import { fullName, oneDecimal } from '../lib/format'

export function emptyMember(): MemberInput {
  return {
    firstName: '',
    lastName: '',
    gender: 'MALE',
    dob: null,
    mobileNumber: '',
    secondaryNumber: '',
    nic: '',
    address: '',
    occupation: '',
    weight: '',
    height: ''
  }
}

export function memberToInput(m: Member): MemberInput {
  return {
    firstName: m.firstName,
    lastName: m.lastName,
    gender: m.gender,
    dob: m.dob,
    mobileNumber: m.mobileNumber ?? '',
    secondaryNumber: m.secondaryNumber ?? '',
    nic: m.nic ?? '',
    address: m.address ?? '',
    occupation: m.occupation ?? '',
    weight: m.weight === null ? '' : oneDecimal(m.weight),
    height: m.height === null ? '' : oneDecimal(m.height)
  }
}

/**
 * The member fields, bound to `form` under `prefix` (e.g. "members.0.member.").
 * `afterMobile` renders right under the phone fields, where it will be seen.
 */
export function MemberFields({
  form,
  prefix = '',
  afterMobile
}: {
  form: UseFormReturnType<any>
  prefix?: string
  afterMobile?: ReactNode
}) {
  const field = (name: keyof MemberInput) => form.getInputProps(`${prefix}${name}`)
  return (
    <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
      <TextInput label="First name" withAsterisk {...field('firstName')} />
      <TextInput label="Last name" withAsterisk {...field('lastName')} />
      <TextInput label="Mobile number" withAsterisk placeholder="07X XXX XXXX" {...field('mobileNumber')} />
      <TextInput label="Other number" {...field('secondaryNumber')} />
      {afterMobile && <div style={{ gridColumn: 'span 2' }}>{afterMobile}</div>}
      <Input.Wrapper label="Gender" withAsterisk error={field('gender').error}>
        <SegmentedControl
          fullWidth
          data={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
          value={field('gender').value}
          onChange={field('gender').onChange}
        />
      </Input.Wrapper>
      <DatePickerInput
        label="Date of birth"
        placeholder="Pick a date"
        valueFormat="D MMM YYYY"
        defaultLevel="decade"
        maxDate={todayIso()}
        clearable
        leftSection={<IconCalendar size={16} />}
        {...field('dob')}
      />
      <TextInput label="NIC" {...field('nic')} />
      <TextInput label="Occupation" {...field('occupation')} />
      <NumberInput label="Height (cm)" min={0} allowNegative={false} {...field('height')} />
      <NumberInput label="Weight (kg)" min={0} allowNegative={false} {...field('weight')} />
      <Textarea label="Address" autosize minRows={1} style={{ gridColumn: 'span 2' }} {...field('address')} />
    </SimpleGrid>
  )
}

/**
 * Warns while typing a mobile number that already belongs to someone, the
 * main way duplicate members got created in the old app.
 */
export function MobileMatches({
  mobile,
  excludeId,
  actionLabel,
  onAction
}: {
  mobile: string
  excludeId?: string
  actionLabel: string
  onAction: (member: Member) => void
}) {
  const [debounced] = useDebouncedValue(mobile.replace(/\D/g, ''), 350)
  const { data = [] } = useQuery({
    queryKey: ['findByMobile', debounced],
    queryFn: () => api.members.findByMobile(debounced),
    enabled: debounced.length >= 9
  })
  const matches = debounced.length >= 9 ? data.filter((m) => m.id !== excludeId) : []
  if (matches.length === 0) return null
  return (
    <Alert color="orange" variant="light" icon={<IconUserExclamation size={18} />} title="This number is already registered">
      {matches.map((m) => (
        <Group key={m.id} justify="space-between" mt={4}>
          <Text size="sm">
            {fullName(m)} · {m.mobileNumber}
            {m.nic ? ` · NIC ${m.nic}` : ''}
          </Text>
          <Button size="compact-sm" variant="white" color="orange" onClick={() => onAction(m)}>
            {actionLabel}
          </Button>
        </Group>
      ))}
    </Alert>
  )
}

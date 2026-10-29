import {
  Alert,
  Badge,
  Button,
  Center,
  Checkbox,
  CloseButton,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Table,
  Text,
  Title
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { schemaResolver, useForm, type UseFormReturnType } from '@mantine/form'
import { IconCalendar, IconInfoCircle, IconUserPlus } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { MemberListItem, MembershipType, Registration } from '@shared/api'
import { addDays, computeEndDate, todayIso } from '@shared/dates'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, durationLabel, type PaymentType } from '@shared/enums'
import { DEFAULT_BREAK_DAYS, joiningFeeAdvice, type JoiningFeeAdvice } from '@shared/joining'
import {
  registrationCreateInput,
  type MemberInput,
  type RegistrationCreateInput,
  type RegistrationMemberInput
} from '@shared/schemas'
import { emptyMember, MemberFields, MobileMatches } from '../components/MemberFields'
import { PageHeader } from '../components/PageHeader'
import { useReceipt } from '../components/ReceiptDialog'
import { api, useAction } from '../lib/api'
import { formatDate, fullName, lkr } from '../lib/format'
import { useMembers, useMembershipTypes } from '../lib/queries'

type Values = RegistrationCreateInput
type Form = UseFormReturnType<Values>

const STEP_FIELDS = [['membershipTypeId', 'startDate', 'endDate', 'amount'], ['members'], ['payment']]

const newSlot = (): RegistrationMemberInput => ({ kind: 'new', member: emptyMember() })

// NumberInput shows '' as empty; the schema then asks for a value.
const EMPTY_NUMBER = '' as unknown as number

interface SlotFee {
  /** The plan's joining fee; 0 when it has none. */
  fee: number
  /** The usual rule for this member; null until an existing member is chosen. */
  advice: JoiningFeeAdvice | null
  /** Ticked unless staff change it. */
  byDefault: boolean
  charged: boolean
}

/**
 * Each member's joining fee, unless staff ticked or unticked it. New members
 * pay it. On a renewal, existing members don't by default (they're already
 * members); the break rule is only pointed out. In a new registration an
 * existing member back after a long break has it ticked.
 */
function slotFees(
  values: Values,
  types: MembershipType[],
  members: MemberListItem[],
  breakDays: number,
  renewing: boolean
): SlotFee[] {
  const fee = types.find((t) => t.id === values.membershipTypeId)?.joiningFee ?? 0
  return values.members.map((slot) => {
    let advice: JoiningFeeAdvice | null = { due: true, reason: 'New member' }
    if (slot.kind === 'existing') {
      const member = members.find((m) => m.id === slot.memberId)
      advice = member ? joiningFeeAdvice(member.lastEndDate, String(values.startDate), breakDays) : null
    }
    const byDefault = advice !== null && advice.due && !(renewing && slot.kind === 'existing')
    return { fee, advice, byDefault, charged: fee > 0 && advice !== null && (slot.chargeJoiningFee ?? byDefault) }
  })
}

const totalFees = (fees: SlotFee[]): number => fees.reduce((sum, f) => sum + (f.charged ? f.fee : 0), 0)

function initialValues(types: MembershipType[], renewFrom?: Registration, memberId?: string | null): Values {
  const today = todayIso()
  if (renewFrom) {
    const type = types.find((t) => t.id === renewFrom.membershipTypeId && !t.archived)
    // Renewing early continues from the old end date; a lapsed one starts today.
    const start = renewFrom.endDate >= today ? addDays(renewFrom.endDate, 1) : today
    return {
      membershipTypeId: type?.id ?? '',
      startDate: start,
      endDate: type ? computeEndDate(start, type.duration, type.durationType) : '',
      amount: type?.price ?? EMPTY_NUMBER,
      members: renewFrom.members.map((m) => ({ kind: 'existing', memberId: m.id })),
      payment: { amount: type?.price ?? EMPTY_NUMBER, paymentType: 'CASH' }
    }
  }
  return {
    membershipTypeId: '',
    startDate: today,
    endDate: '',
    amount: EMPTY_NUMBER,
    members: [memberId ? { kind: 'existing', memberId } : newSlot()],
    payment: { amount: EMPTY_NUMBER, paymentType: 'CASH' }
  }
}

function PlanStep({ form, types }: { form: Form; types: MembershipType[] }) {
  const type = types.find((t) => t.id === form.values.membershipTypeId)

  const applyPlan = (id: string | null) => {
    const t = types.find((x) => x.id === id)
    form.setFieldValue('membershipTypeId', id ?? '')
    if (!t) return
    form.setFieldValue('amount', t.price)
    if (form.values.startDate) {
      form.setFieldValue('endDate', computeEndDate(String(form.values.startDate), t.duration, t.durationType))
    }
    // One slot per person on the plan; keep what's already been filled in.
    const slots = form.values.members.slice(0, t.numberOfMembers)
    while (slots.length < t.numberOfMembers) slots.push(newSlot())
    form.setFieldValue('members', slots)
  }

  return (
    <Stack maw={640}>
      <Select
        label="Plan"
        placeholder="Choose a plan"
        searchable
        withAsterisk
        data={types
          .filter((t) => !t.archived)
          .map((t) => ({
            value: t.id,
            label: `${t.name} — ${lkr(t.price)} · ${durationLabel(t.duration, t.durationType)}${t.numberOfMembers > 1 ? ` · ${t.numberOfMembers} people` : ''}`
          }))}
        {...form.getInputProps('membershipTypeId')}
        onChange={applyPlan}
      />
      <Group grow align="flex-start">
        <DatePickerInput
          label="Start date"
          valueFormat="D MMM YYYY"
          withAsterisk
          leftSection={<IconCalendar size={16} />}
          {...form.getInputProps('startDate')}
          value={String(form.values.startDate || '') || null}
          onChange={(d) => {
            form.setFieldValue('startDate', d ?? '')
            if (type && d) form.setFieldValue('endDate', computeEndDate(d, type.duration, type.durationType))
          }}
        />
        <DatePickerInput
          label="End date"
          valueFormat="D MMM YYYY"
          withAsterisk
          leftSection={<IconCalendar size={16} />}
          description={type ? `Start + ${durationLabel(type.duration, type.durationType)}, less a day` : undefined}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          minDate={String(form.values.startDate || '') || undefined}
          {...form.getInputProps('endDate')}
          // Empty until a plan is chosen; '' would render as "Invalid Date".
          value={String(form.values.endDate || '') || null}
        />
      </Group>
      <NumberInput
        label="Plan amount"
        prefix="Rs. "
        min={0}
        withAsterisk
        description={
          [
            type && Number(form.values.amount) !== type.price ? `Plan price is ${lkr(type.price)}.` : '',
            type && type.joiningFee > 0 ? `Joining fees (${lkr(type.joiningFee)} per new member) come next.` : ''
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        {...form.getInputProps('amount')}
      />
    </Stack>
  )
}

function JoiningFeeCheckbox({ form, index, fee }: { form: Form; index: number; fee: SlotFee }) {
  if (fee.fee === 0 || !fee.advice) return null
  const override = form.values.members[index].chargeJoiningFee
  const changed = override != null && override !== fee.byDefault
  let description = fee.advice.reason
  if (changed) description += ` · ${fee.charged ? 'added' : 'waived'} by you`
  else if (fee.advice.due && !fee.byDefault) description += ' · tick to charge it'
  return (
    <Checkbox
      mt="md"
      checked={fee.charged}
      onChange={(e) => form.setFieldValue(`members.${index}.chargeJoiningFee`, e.currentTarget.checked)}
      label={`Joining fee ${lkr(fee.fee)}`}
      description={description}
    />
  )
}

function MemberSlot({
  form,
  index,
  memberOptions,
  takenIds,
  removable,
  locked,
  fee
}: {
  form: Form
  index: number
  memberOptions: MemberListItem[]
  takenIds: string[]
  removable: boolean
  /** Renewing: the main member is who's being renewed, so they can't be swapped. */
  locked: boolean
  fee: SlotFee
}) {
  const slot = form.values.members[index]
  const path = `members.${index}`
  const setKind = (kind: string) =>
    form.setFieldValue(path as `members.${number}`, kind === 'new' ? newSlot() : { kind: 'existing', memberId: '' })
  const lockedMember = locked && slot.kind === 'existing' ? memberOptions.find((m) => m.id === slot.memberId) : undefined

  return (
    <Paper p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>{index === 0 ? 'Main member' : `Member ${index + 1}`}</Text>
        {locked ? (
          <Badge variant="light">Renewing</Badge>
        ) : (
          <Group gap="xs">
            <SegmentedControl
              size="xs"
              value={slot.kind}
              onChange={setKind}
              data={[
                { value: 'existing', label: 'Existing member' },
                { value: 'new', label: 'New member' }
              ]}
            />
            {removable && (
              <CloseButton aria-label="Remove this member" onClick={() => form.removeListItem('members', index)} />
            )}
          </Group>
        )}
      </Group>
      {locked ? (
        <Stack gap={2}>
          <Text size="lg" fw={500}>
            {lockedMember
              ? `${fullName(lockedMember)}${lockedMember.mobileNumber ? ` · ${lockedMember.mobileNumber}` : ''}`
              : 'Unknown member'}
          </Text>
          <Text size="xs" c="dimmed">
            To register someone else, use New registration instead.
          </Text>
        </Stack>
      ) : slot.kind === 'existing' ? (
        <Select
          placeholder="Search by name or phone"
          searchable
          limit={30}
          nothingFoundMessage="No member found. Switch to New member to add them."
          data={memberOptions
            .filter((m) => m.id === slot.memberId || !takenIds.includes(m.id))
            .map((m) => ({ value: m.id, label: `${fullName(m)}${m.mobileNumber ? ` · ${m.mobileNumber}` : ''}` }))}
          {...form.getInputProps(`${path}.memberId`)}
          onChange={(id) =>
            // A different person: back to the usual joining fee rule for them.
            form.setFieldValue(path as `members.${number}`, { kind: 'existing', memberId: id ?? '' })
          }
        />
      ) : (
        <MemberFields
          form={form}
          prefix={`${path}.member.`}
          afterMobile={
            <MobileMatches
              mobile={String((slot.member as MemberInput).mobileNumber ?? '')}
              actionLabel="Use this member"
              onAction={(m) => form.setFieldValue(path as `members.${number}`, { kind: 'existing', memberId: m.id })}
            />
          }
        />
      )}
      <JoiningFeeCheckbox form={form} index={index} fee={fee} />
    </Paper>
  )
}

function MembersStep({
  form,
  types,
  members,
  fees,
  renewing
}: {
  form: Form
  types: MembershipType[]
  members: MemberListItem[]
  fees: SlotFee[]
  renewing: boolean
}) {
  const type = types.find((t) => t.id === form.values.membershipTypeId)
  const max = type?.numberOfMembers ?? 1
  const chosen = form.values.members.flatMap((s) => (s.kind === 'existing' && s.memberId ? [s.memberId] : []))
  const charged = fees.filter((f) => f.charged).length
  return (
    <Stack maw={820}>
      {form.values.members.map((_, i) => (
        <MemberSlot
          key={i}
          form={form}
          index={i}
          memberOptions={members}
          takenIds={chosen}
          removable={i > 0}
          locked={renewing && i === 0}
          fee={fees[i]}
        />
      ))}
      {typeof form.errors.members === 'string' && <Text c="red" size="sm">{form.errors.members}</Text>}
      {charged > 0 && (
        <Text size="sm">
          Joining fees: <b>{lkr(totalFees(fees))}</b> ({charged} {charged === 1 ? 'person' : 'people'}), added to the
          plan amount.
        </Text>
      )}
      {form.values.members.length < max && (
        <Button
          variant="default"
          leftSection={<IconUserPlus size={16} />}
          onClick={() => form.insertListItem('members', newSlot())}
          w="fit-content"
        >
          Add member {form.values.members.length + 1} of {max}
        </Button>
      )}
    </Stack>
  )
}

function PaymentStep({ form, joiningFees }: { form: Form; joiningFees: number }) {
  const plan = Number(form.values.amount) || 0
  const amount = plan + joiningFees
  const paid = Number(form.values.payment.amount) || 0
  return (
    <Stack maw={480}>
      <Text size="sm">
        {joiningFees > 0 ? `Plan ${lkr(plan)} + joining fees ${lkr(joiningFees)} = ` : 'Total '}
        <b>{lkr(amount)}</b>
      </Text>
      <NumberInput label="Amount paid now" prefix="Rs. " min={0} {...form.getInputProps('payment.amount')} />
      <SegmentedControl
        data={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))}
        {...form.getInputProps('payment.paymentType')}
      />
      {paid < amount ? (
        <Alert color="orange" icon={<IconInfoCircle />}>
          {lkr(amount - paid)} will be left to pay. You can add the rest later from the member’s page.
        </Alert>
      ) : paid > amount ? (
        <Alert color="yellow" icon={<IconInfoCircle />}>
          That’s {lkr(paid - amount)} more than the registration amount.
        </Alert>
      ) : null}
    </Stack>
  )
}

function ReviewStep({
  form,
  types,
  members,
  fees
}: {
  form: Form
  types: MembershipType[]
  members: MemberListItem[]
  fees: SlotFee[]
}) {
  const v = form.values
  const type = types.find((t) => t.id === v.membershipTypeId)
  const names = v.members.map((s) => {
    if (s.kind === 'existing') {
      const m = members.find((x) => x.id === s.memberId)
      return m ? fullName(m) : 'Unknown member'
    }
    const m = s.member as MemberInput
    return `${m.firstName} ${m.lastName}`.trim()
  })
  const joiningFees = totalFees(fees)
  const total = Number(v.amount) + joiningFees
  const rows: [string, string][] = [
    ['Plan', type?.name ?? '—'],
    ['Members', names.map((n, i) => `${n} (${v.members[i].kind === 'new' ? 'new' : 'existing'})`).join(', ')],
    ['Dates', `${formatDate(String(v.startDate))} → ${formatDate(String(v.endDate))}`],
    ['Plan amount', lkr(Number(v.amount))],
    ...(joiningFees > 0
      ? ([
          ['Joining fees', `${lkr(joiningFees)} (${names.filter((_, i) => fees[i].charged).join(', ')})`],
          ['Total', lkr(total)]
        ] as [string, string][])
      : []),
    ['Paid now', `${lkr(Number(v.payment.amount))} (${PAYMENT_TYPE_LABELS[v.payment.paymentType as PaymentType]})`],
    ['Balance', lkr(Math.max(0, total - Number(v.payment.amount)))]
  ]
  return (
    <Paper p="md" maw={640}>
      <Table>
        <Table.Tbody>
          {rows.map(([k, val]) => (
            <Table.Tr key={k}>
              <Table.Th w={140}>{k}</Table.Th>
              <Table.Td>{val}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}

function Wizard({
  types,
  members,
  renewFrom,
  presetMemberId,
  breakDays
}: {
  types: MembershipType[]
  members: MemberListItem[]
  renewFrom?: Registration
  presetMemberId: string | null
  breakDays: number
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState(0)
  const form = useForm<Values>({
    initialValues: initialValues(types, renewFrom, presetMemberId),
    validate: schemaResolver(registrationCreateInput, { sync: true })
  })
  const create = useAction((v: Values) => api.registrations.create(v), { success: 'Registration saved' })
  const { showReceipt } = useReceipt()
  const fees = slotFees(form.values, types, members, breakDays, Boolean(renewFrom))
  const joiningFees = totalFees(fees)

  // Validate everything, but only show (and block on) this step's fields.
  const validateStep = (s: number): boolean => {
    const { errors } = form.validate()
    const mine = Object.entries(errors).filter(([key]) =>
      STEP_FIELDS[s].some((f) => key === f || key.startsWith(`${f}.`))
    )
    form.setErrors(Object.fromEntries(mine))
    return mine.length === 0
  }
  const next = () => {
    if (!validateStep(step)) return
    // Into the payment step: suggest the full total, unless staff already typed what was paid.
    if (step === 1 && !form.isTouched('payment.amount')) {
      form.setFieldValue('payment.amount', (Number(form.values.amount) || 0) + joiningFees)
    }
    setStep((s) => s + 1)
  }
  const leave = () => (location.key !== 'default' ? navigate(-1) : navigate('/registrations'))

  const submit = () => {
    for (let s = 0; s < STEP_FIELDS.length; s++) {
      if (!validateStep(s)) {
        setStep(s)
        return
      }
    }
    // Send what staff see for each member, ticked or not.
    const members = form.values.members.map((slot, i) => ({ ...slot, chargeJoiningFee: fees[i].charged }))
    create.mutate([{ ...form.values, members }], {
      onSuccess: (created) => {
        leave()
        if (created.paymentId) showReceipt(created.paymentId, true)
      }
    })
  }

  return (
    <>
      {renewFrom && (
        <Alert mb="md" variant="light" icon={<IconInfoCircle />}>
          Renewing {renewFrom.membershipTypeName} for {renewFrom.members.map(fullName).join(', ')}, which ended{' '}
          {formatDate(renewFrom.endDate)}.
          {!types.find((t) => t.id === renewFrom.membershipTypeId && !t.archived) &&
            ' That plan is archived, so choose a current one.'}
        </Alert>
      )}
      <Paper p="lg">
        <Stepper active={step} onStepClick={(s) => s < step && setStep(s)} mb="xl">
          <Stepper.Step label="Plan" description="Plan and dates">
            <PlanStep form={form} types={types} />
          </Stepper.Step>
          <Stepper.Step label="Members" description="Who’s joining">
            <MembersStep form={form} types={types} members={members} fees={fees} renewing={Boolean(renewFrom)} />
          </Stepper.Step>
          <Stepper.Step label="Payment" description="What they paid">
            <PaymentStep form={form} joiningFees={joiningFees} />
          </Stepper.Step>
          <Stepper.Step label="Review" description="Check and save">
            <ReviewStep form={form} types={types} members={members} fees={fees} />
          </Stepper.Step>
        </Stepper>
        <Group justify="space-between">
          <Button variant="default" onClick={() => (step === 0 ? leave() : setStep(step - 1))}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={submit} loading={create.isPending}>
              Save registration
            </Button>
          )}
        </Group>
      </Paper>
    </>
  )
}

export function RegistrationWizard() {
  const [params] = useSearchParams()
  const renewId = params.get('renew')
  const memberId = params.get('member')
  const types = useMembershipTypes()
  const members = useMembers()
  const joining = useQuery({ queryKey: ['joiningFeeSettings'], queryFn: () => api.joiningFee.settings() })
  const renewFrom = useQuery({
    queryKey: ['registration', renewId],
    queryFn: () => api.registrations.get(renewId!),
    enabled: Boolean(renewId)
  })
  const sortedMembers = useMemo(
    () => [...(members.data ?? [])].sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [members.data]
  )

  const loading =
    types.isPending || members.isPending || joining.isPending || (Boolean(renewId) && renewFrom.isPending)
  return (
    <>
      <PageHeader title={renewId ? 'Renew membership' : 'New registration'} />
      {loading ? (
        <Center h={240}>
          <Loader />
        </Center>
      ) : renewFrom.error ? (
        <Alert color="red">{renewFrom.error.message}</Alert>
      ) : (
        <Wizard
          key={renewId ?? memberId ?? 'new'}
          types={types.data ?? []}
          members={sortedMembers}
          renewFrom={renewFrom.data}
          presetMemberId={memberId}
          breakDays={joining.data?.breakDays ?? DEFAULT_BREAK_DAYS}
        />
      )}
      {!loading && (types.data ?? []).filter((t) => !t.archived).length === 0 && (
        <Alert color="yellow" mt="md">
          <Title order={5}>No plans yet</Title>
          Add a plan under Plans before registering anyone.
        </Alert>
      )}
    </>
  )
}

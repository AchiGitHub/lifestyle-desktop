import { Button, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { schemaResolver, useForm } from '@mantine/form'
import type { Registration } from '@shared/api'
import { computeEndDate } from '@shared/dates'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, durationLabel } from '@shared/enums'
import {
  paymentAddInput,
  registrationUpdateInput,
  type PaymentAddInput,
  type RegistrationUpdateInput
} from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { lkr } from '../lib/format'
import { useMembershipTypes } from '../lib/queries'
import { useReceipt } from './ReceiptDialog'

function AddPaymentForm({ registration, onClose }: { registration: Registration; onClose: () => void }) {
  const form = useForm<PaymentAddInput>({
    initialValues: { registrationId: registration.id, amount: registration.balance || '', paymentType: 'CASH' } as PaymentAddInput,
    validate: schemaResolver(paymentAddInput, { sync: true })
  })
  const add = useAction((v: PaymentAddInput) => api.payments.add(v), { success: 'Payment recorded' })
  const { showReceipt } = useReceipt()
  const done = (paymentId: string) => {
    onClose()
    showReceipt(paymentId, true)
  }
  return (
    <form onSubmit={form.onSubmit((v) => add.mutate([v], { onSuccess: done }))}>
      <Stack>
        <Text size="sm" c="dimmed">
          {registration.membershipTypeName} · {lkr(registration.amount)} · paid {lkr(registration.paid)} · balance{' '}
          {lkr(registration.balance)}
        </Text>
        <NumberInput label="Amount" prefix="Rs. " min={0} data-autofocus {...form.getInputProps('amount')} />
        <SegmentedControl
          data={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))}
          {...form.getInputProps('paymentType')}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={add.isPending}>
            Record payment
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function AddPaymentModal({ registration, onClose }: { registration: Registration | null; onClose: () => void }) {
  return (
    <Modal opened={registration !== null} onClose={onClose} title="Add payment">
      {registration && <AddPaymentForm registration={registration} onClose={onClose} />}
    </Modal>
  )
}

function EditRegistrationForm({ registration, onClose }: { registration: Registration; onClose: () => void }) {
  const { data: types = [] } = useMembershipTypes()
  const form = useForm<RegistrationUpdateInput>({
    initialValues: {
      membershipTypeId: registration.membershipTypeId,
      startDate: registration.startDate,
      endDate: registration.endDate,
      amount: registration.amount
    },
    validate: schemaResolver(registrationUpdateInput, { sync: true })
  })
  const save = useAction((v: RegistrationUpdateInput) => api.registrations.update(registration.id, v), {
    success: 'Registration updated'
  })
  const recompute = (typeId: string | null, start: string | null) => {
    const type = types.find((t) => t.id === typeId)
    if (type && start) form.setFieldValue('endDate', computeEndDate(start, type.duration, type.durationType))
  }

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <Select
          label="Plan"
          searchable
          data={types
            .filter((t) => !t.archived || t.id === registration.membershipTypeId)
            .map((t) => ({ value: t.id, label: `${t.name} · ${durationLabel(t.duration, t.durationType)}` }))}
          {...form.getInputProps('membershipTypeId')}
          onChange={(id) => {
            form.setFieldValue('membershipTypeId', id ?? '')
            recompute(id, String(form.values.startDate))
          }}
        />
        <Group grow>
          <DatePickerInput
            label="Start date"
            valueFormat="D MMM YYYY"
            {...form.getInputProps('startDate')}
            onChange={(d) => {
              form.setFieldValue('startDate', d ?? '')
              recompute(String(form.values.membershipTypeId), d)
            }}
          />
          <DatePickerInput label="End date" valueFormat="D MMM YYYY" {...form.getInputProps('endDate')} />
        </Group>
        <NumberInput
          label="Amount"
          prefix="Rs. "
          min={0}
          description={
            registration.joiningFee > 0 ? `Includes joining fees of ${lkr(registration.joiningFee)}` : undefined
          }
          {...form.getInputProps('amount')}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function EditRegistrationModal({
  registration,
  onClose
}: {
  registration: Registration | null
  onClose: () => void
}) {
  return (
    <Modal opened={registration !== null} onClose={onClose} title="Edit registration">
      {registration && <EditRegistrationForm registration={registration} onClose={onClose} />}
    </Modal>
  )
}

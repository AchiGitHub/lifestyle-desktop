import { ActionIcon, Badge, Button, Group, Menu, Modal, NumberInput, SegmentedControl, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { IconCash, IconDots, IconPencil, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import type { PtRegistration } from '@shared/api'
import { addDays, computeEndDate, todayIso } from '@shared/dates'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, durationLabel } from '@shared/enums'
import {
  ptCreateInput,
  ptPaymentInput,
  ptUpdateInput,
  type PtCreateInput,
  type PtPaymentInput,
  type PtUpdateInput
} from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { formatDate, lkr } from '../lib/format'
import { usePtPackages, useTrainers } from '../lib/queries'
import { useMemberOptions } from './MemberSearch'
import { useReceipt } from './ReceiptDialog'

export type PtState = 'ACTIVE' | 'NOT_STARTED' | 'USED_UP' | 'EXPIRED'
export const PT_STATE_LABELS: Record<PtState, string> = {
  ACTIVE: 'Active',
  NOT_STARTED: 'Not started',
  USED_UP: 'Used up',
  EXPIRED: 'Expired'
}
const PT_STATE_COLORS: Record<PtState, string> = { ACTIVE: 'teal', NOT_STARTED: 'blue', USED_UP: 'gray', EXPIRED: 'red' }

export function ptState(pt: PtRegistration, today = todayIso()): PtState {
  if (pt.left === 0) return 'USED_UP'
  if (pt.endDate < today) return 'EXPIRED'
  if (pt.startDate > today) return 'NOT_STARTED'
  return 'ACTIVE'
}

export function PtStateBadge({ pt }: { pt: PtRegistration }) {
  const state = ptState(pt)
  return (
    <Badge variant="light" color={PT_STATE_COLORS[state]}>
      {PT_STATE_LABELS[state]}
    </Badge>
  )
}

/** What a new package starts from: a member, or a package being renewed. */
export interface PtStart {
  memberId?: string
  trainerId?: string
  packageId?: string
  startDate?: string
}

/** A renewal starts the day after the old package ends, or today if that's passed. */
export function renewalOf(pt: PtRegistration): PtStart {
  const next = addDays(pt.endDate, 1)
  return {
    memberId: pt.memberId,
    trainerId: pt.trainerId,
    packageId: pt.packageId ?? undefined,
    startDate: next > todayIso() ? next : todayIso()
  }
}

/** The trainer's % of the price, in whole rupees; nothing for the owner. */
const commissionFor = (amount: unknown, trainer?: { isOwner: boolean; commissionPercent: number }): number =>
  trainer && !trainer.isOwner ? Math.round(((Number(amount) || 0) * trainer.commissionPercent) / 100) : 0

function PtSellForm({ start, onClose }: { start: PtStart; onClose: () => void }) {
  const members = useMemberOptions()
  const { data: trainers = [] } = useTrainers()
  const { data: types = [] } = usePtPackages()
  const { showReceipt } = useReceipt()
  const form = useForm<PtCreateInput>({
    initialValues: {
      memberId: start.memberId ?? '',
      trainerId: start.trainerId ?? '',
      packageId: '',
      sessions: '',
      startDate: start.startDate ?? todayIso(),
      endDate: '',
      amount: '',
      commission: 0,
      payment: { amount: 0, paymentType: 'CASH' }
    } as unknown as PtCreateInput,
    validate: schemaResolver(ptCreateInput, { sync: true })
  })
  // The commission follows the trainer's % until it's typed in by hand.
  const [commissionTyped, setCommissionTyped] = useState(false)
  const create = useAction((v: PtCreateInput) => api.personalTraining.create(v), { success: 'Package added' })

  const fill = (patch: Partial<Pick<PtCreateInput, 'trainerId' | 'packageId' | 'startDate' | 'amount'>>) => {
    const v = { ...form.values, ...patch }
    const type = types.find((t) => t.id === v.packageId)
    const next: Partial<PtCreateInput> = { ...patch }
    if (patch.packageId && type) {
      next.sessions = type.sessions
      next.amount = v.amount = type.price
    }
    if ((patch.packageId || patch.startDate) && type && v.startDate) {
      next.endDate = computeEndDate(v.startDate, type.validDuration, type.validDurationType)
    }
    if (!commissionTyped) next.commission = commissionFor(v.amount, trainers.find((t) => t.id === v.trainerId))
    form.setValues(next)
  }

  // Renewing: the old session type, once the lists have loaded.
  const filled = useRef(false)
  useEffect(() => {
    if (filled.current || types.length === 0 || trainers.length === 0) return
    filled.current = true
    const type = types.find((t) => t.id === start.packageId && !t.archived)
    if (type) fill({ packageId: type.id })
  }, [types, trainers]) // fill is remade each render; this only needs to run once the lists arrive

  const trainer = trainers.find((t) => t.id === form.values.trainerId)
  const type = types.find((t) => t.id === form.values.packageId)
  return (
    <form
      onSubmit={form.onSubmit((v) =>
        create.mutate([v], {
          onSuccess: (pt) => {
            onClose()
            if (pt.paymentId) showReceipt(pt.paymentId, true)
          }
        })
      )}
    >
      <Stack>
        <Select
          label="Member"
          placeholder="Search by name or phone"
          description="Needs a membership that hasn’t ended"
          data={members.options}
          filter={members.filter}
          limit={12}
          searchable
          nothingFoundMessage="No member found"
          withAsterisk
          {...form.getInputProps('memberId')}
        />
        <Group grow align="flex-start">
          <Select
            label="Trainer"
            withAsterisk
            data={trainers
              .filter((t) => !t.archived)
              .map((t) => ({ value: t.id, label: t.isOwner ? `${t.name} (owner)` : `${t.name} · ${t.commissionPercent}%` }))}
            nothingFoundMessage="Add trainers in Settings"
            {...form.getInputProps('trainerId')}
            onChange={(id) => fill({ trainerId: id ?? '' })}
          />
          <Select
            label="Session type"
            withAsterisk
            data={types
              .filter((t) => !t.archived)
              .map((t) => ({ value: t.id, label: `${t.name} · ${lkr(t.price)}` }))}
            nothingFoundMessage="Add session types on the Session types tab"
            {...form.getInputProps('packageId')}
            onChange={(id) => fill({ packageId: id ?? '' })}
          />
        </Group>
        <Group grow align="flex-start">
          <NumberInput label="Sessions" min={1} allowDecimal={false} {...form.getInputProps('sessions')} />
          <NumberInput
            label="Price"
            prefix="Rs. "
            min={0}
            {...form.getInputProps('amount')}
            onChange={(n) => fill({ amount: n as number })}
          />
        </Group>
        <Group grow align="flex-start">
          <DatePickerInput
            label="Starts"
            valueFormat="D MMM YYYY"
            {...form.getInputProps('startDate')}
            onChange={(d) => fill({ startDate: d ?? '' })}
          />
          <DatePickerInput
            label="Use by"
            valueFormat="D MMM YYYY"
            description={type ? `Within ${durationLabel(type.validDuration, type.validDurationType)}` : undefined}
            {...form.getInputProps('endDate')}
          />
        </Group>
        {trainer && !trainer.isOwner && (
          <NumberInput
            label={`Commission for ${trainer.name}`}
            description={`${trainer.commissionPercent}% of the price is ${lkr(commissionFor(form.values.amount, trainer))}`}
            prefix="Rs. "
            min={0}
            {...form.getInputProps('commission')}
            onChange={(n) => {
              setCommissionTyped(true)
              form.setFieldValue('commission', n as number)
            }}
          />
        )}
        <Group grow align="flex-end">
          <NumberInput label="Paid now" prefix="Rs. " min={0} {...form.getInputProps('payment.amount')} />
          <SegmentedControl
            data={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))}
            {...form.getInputProps('payment.paymentType')}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add package
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function PtSellModal({ start, onClose }: { start: PtStart | null; onClose: () => void }) {
  return (
    <Modal opened={start !== null} onClose={onClose} title="New personal training package" size="lg">
      {start && <PtSellForm start={start} onClose={onClose} />}
    </Modal>
  )
}

function PtEditForm({ pt, onClose }: { pt: PtRegistration; onClose: () => void }) {
  const { data: trainers = [] } = useTrainers()
  const form = useForm<PtUpdateInput>({
    initialValues: {
      trainerId: pt.trainerId,
      sessions: pt.sessions,
      startDate: pt.startDate,
      endDate: pt.endDate,
      amount: pt.amount,
      commission: pt.commission
    },
    validate: schemaResolver(ptUpdateInput, { sync: true })
  })
  const save = useAction((v: PtUpdateInput) => api.personalTraining.update(pt.id, v), { success: 'Package updated' })
  const trainer = trainers.find((t) => t.id === form.values.trainerId)
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <Text size="sm" c="dimmed">
          {pt.memberName} · {pt.packageName} · {pt.used} of {pt.sessions} sessions had
        </Text>
        <Select
          label="Trainer"
          data={trainers
            .filter((t) => !t.archived || t.id === pt.trainerId)
            .map((t) => ({ value: t.id, label: t.isOwner ? `${t.name} (owner)` : t.name }))}
          {...form.getInputProps('trainerId')}
        />
        <Group grow align="flex-start">
          <NumberInput label="Sessions" min={Math.max(1, pt.used)} allowDecimal={false} {...form.getInputProps('sessions')} />
          <NumberInput label="Price" prefix="Rs. " min={0} {...form.getInputProps('amount')} />
        </Group>
        <Group grow>
          <DatePickerInput label="Starts" valueFormat="D MMM YYYY" {...form.getInputProps('startDate')} />
          <DatePickerInput
            label="Use by"
            description="Move it on to give them longer"
            valueFormat="D MMM YYYY"
            {...form.getInputProps('endDate')}
          />
        </Group>
        {trainer && !trainer.isOwner && (
          <NumberInput label={`Commission for ${trainer.name}`} prefix="Rs. " min={0} {...form.getInputProps('commission')} />
        )}
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

function PtPaymentForm({ pt, onClose }: { pt: PtRegistration; onClose: () => void }) {
  const form = useForm<PtPaymentInput>({
    initialValues: { ptRegistrationId: pt.id, amount: pt.balance || '', paymentType: 'CASH' } as PtPaymentInput,
    validate: schemaResolver(ptPaymentInput, { sync: true })
  })
  const add = useAction((v: PtPaymentInput) => api.personalTraining.addPayment(v), { success: 'Payment recorded' })
  const { showReceipt } = useReceipt()
  return (
    <form
      onSubmit={form.onSubmit((v) =>
        add.mutate([v], {
          onSuccess: (paymentId) => {
            onClose()
            showReceipt(paymentId, true)
          }
        })
      )}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {pt.packageName} with {pt.trainerName} · {lkr(pt.amount)} · paid {lkr(pt.paid)} · balance {lkr(pt.balance)}
        </Text>
        <NumberInput label="Amount" prefix="Rs. " min={0} max={pt.balance} data-autofocus {...form.getInputProps('amount')} />
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

export function PtPaymentModal({ pt, onClose }: { pt: PtRegistration | null; onClose: () => void }) {
  return (
    <Modal opened={pt !== null} onClose={onClose} title="Add payment">
      {pt && <PtPaymentForm pt={pt} onClose={onClose} />}
    </Modal>
  )
}

/** Add payment, Renew, Edit and Delete for one package, each with its own dialog. */
export function PtActions({ pt }: { pt: PtRegistration }) {
  const [open, setOpen] = useState<'pay' | 'edit' | 'renew' | null>(null)
  const remove = useAction((id: string) => api.personalTraining.delete(id), { success: 'Package deleted' })
  const close = () => setOpen(null)
  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label="Package actions">
            <IconDots size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconCash size={16} />} disabled={pt.balance === 0} onClick={() => setOpen('pay')}>
            Add payment
          </Menu.Item>
          <Menu.Item leftSection={<IconRefresh size={16} />} onClick={() => setOpen('renew')}>
            Renew
          </Menu.Item>
          <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setOpen('edit')}>
            Edit
          </Menu.Item>
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={16} />}
            disabled={pt.paid > 0 || pt.used > 0}
            title={pt.paid > 0 || pt.used > 0 ? 'Only a package with no payments or sessions can be deleted' : undefined}
            onClick={() =>
              modals.openConfirmModal({
                title: 'Delete this package?',
                children: (
                  <Text size="sm">
                    {pt.packageName} for {pt.memberName}, from {formatDate(pt.startDate)}. It has no payments or sessions.
                  </Text>
                ),
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => remove.mutate([pt.id])
              })
            }
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <PtPaymentModal pt={open === 'pay' ? pt : null} onClose={close} />
      <Modal opened={open === 'edit'} onClose={close} title="Edit package">
        {open === 'edit' && <PtEditForm pt={pt} onClose={close} />}
      </Modal>
      <PtSellModal start={open === 'renew' ? renewalOf(pt) : null} onClose={close} />
    </>
  )
}

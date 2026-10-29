import { Button, Group, Modal, NumberInput, ScrollArea, SegmentedControl, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconBrandWhatsapp, IconCheck } from '@tabler/icons-react'
import { useState } from 'react'
import type { CreditSale, MemberCredit } from '@shared/api'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, type PaymentType } from '@shared/enums'
import { whatsappNumber } from '@shared/reminders'
import { api, useAction } from '../lib/api'
import { formatDate, formatDateTime, fromNow, fullName, lkr } from '../lib/format'
import { useReceipt } from './ReceiptDialog'

/** Items still to pay for, oldest first; a part-paid one shows what's left of it. */
export function CreditItems({ items }: { items: CreditSale[] }) {
  return (
    <ScrollArea.Autosize mah={240} type="auto" offsetScrollbars>
      <Table verticalSpacing={4} fz="sm">
        <Table.Tbody>
          {items.map((i) => (
            <Table.Tr key={i.id}>
              <Table.Td c="dimmed" w={110} style={{ whiteSpace: 'nowrap' }}>
                {formatDate(i.soldAt)}
              </Table.Td>
              <Table.Td>
                {i.productName} × {i.quantity}
                {i.recordedBy && (
                  <Text span size="xs" c="dimmed">
                    {' '}
                    · sold by {i.recordedBy}
                  </Text>
                )}
              </Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {lkr(i.owed)}
                {i.owed < i.amount && (
                  <Text span size="xs" c="dimmed">
                    {' '}
                    of {lkr(i.amount)}
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  )
}

function CreditPaymentForm({ credit, onClose }: { credit: MemberCredit; onClose: () => void }) {
  const [amount, setAmount] = useState<string | number>(credit.owed)
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH')
  const { showReceipt } = useReceipt()
  const pay = useAction((n: number) => api.credit.pay({ memberId: credit.memberId, amount: n, paymentType }), {
    success: 'Payment recorded'
  })
  const n = typeof amount === 'number' ? amount : NaN
  const valid = n > 0 && n <= credit.owed
  const left = Math.round((credit.owed - n) * 100) / 100
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) {
          pay.mutate([n], {
            onSuccess: (paymentId) => {
              onClose()
              showReceipt(paymentId, true)
            }
          })
        }
      }}
    >
      <Stack>
        <Text size="sm">
          {credit.firstName} owes <b>{lkr(credit.owed)}</b> for:
        </Text>
        <CreditItems items={credit.items} />
        <NumberInput
          label="Amount paid"
          prefix="Rs. "
          min={0}
          max={credit.owed}
          data-autofocus
          value={amount}
          onChange={setAmount}
          error={n > credit.owed ? `They only owe ${lkr(credit.owed)}` : undefined}
        />
        <SegmentedControl
          value={paymentType}
          onChange={(v) => setPaymentType(v as PaymentType)}
          data={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))}
        />
        {valid && (
          <Text size="sm" c="dimmed">
            {left > 0 ? `${lkr(left)} still to pay after this. It pays off the oldest items first.` : 'This pays it all off.'}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pay.isPending} disabled={!valid}>
            Record payment
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

/** Money towards store credit. A receipt opens after, as for every payment. */
export function CreditPaymentModal({ credit, onClose }: { credit: MemberCredit | null; onClose: () => void }) {
  return (
    <Modal opened={credit !== null} onClose={onClose} title={credit ? `Take payment: ${fullName(credit)}` : ''} size="lg">
      {credit && <CreditPaymentForm credit={credit} onClose={onClose} />}
    </Modal>
  )
}

/** Opens WhatsApp with what they owe and for which items typed in; staff check it and press send. */
export function CreditReminderButton({ credit }: { credit: MemberCredit }) {
  const send = useAction((memberId: string) => api.reminders.sendCredit(memberId), {
    success: 'Opening WhatsApp. Check the message, then press send.'
  })
  const reachable = whatsappNumber(credit.mobileNumber) !== null
  const messaged = credit.remindedAt !== null
  return (
    <Tooltip
      label={
        !reachable
          ? 'No mobile number that works with WhatsApp'
          : messaged
            ? `Messaged ${fromNow(credit.remindedAt!)} (${formatDateTime(credit.remindedAt)}). Click to message again.`
            : 'Open WhatsApp with what they owe typed in'
      }
      multiline
      maw={260}
    >
      <Button
        size="xs"
        variant={messaged ? 'subtle' : 'light'}
        color="green"
        leftSection={messaged ? <IconCheck size={14} /> : <IconBrandWhatsapp size={14} />}
        loading={send.isPending}
        data-disabled={!reachable || undefined}
        onClick={!reachable ? (e) => e.preventDefault() : () => send.mutate([credit.memberId])}
      >
        {messaged ? 'Messaged' : 'WhatsApp'}
      </Button>
    </Tooltip>
  )
}

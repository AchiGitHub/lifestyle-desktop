import { Button, Center, Group, Loader, Menu, Modal, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { IconBrandWhatsapp, IconPrinter } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Receipt } from '@shared/api'
import { PAYMENT_TYPE_LABELS } from '@shared/enums'
import { longDateTime } from '@shared/format'
import { whatsappNumber } from '@shared/reminders'
import type { ReceiptRecipientInput } from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { fullName, lkr } from '../lib/format'
import { whatsappRecipients } from './WhatsAppButton'

const ReceiptContext = createContext<{ showReceipt: (paymentId: string, justPaid?: boolean) => void }>({
  showReceipt: () => undefined
})
export const useReceipt = () => useContext(ReceiptContext)

function SendOnWhatsApp({ receipt }: { receipt: Receipt }) {
  // A member whose stored number isn't a valid mobile: start from it so staff can correct it.
  const stored = receipt.members.find((m) => m.mobileNumber?.trim())
  const [phone, setPhone] = useState(stored?.mobileNumber?.trim() ?? '')
  const send = useAction((to: ReceiptRecipientInput) => api.receipts.sendWhatsApp(receipt.paymentId, to), {
    success: 'Opening WhatsApp. Check the receipt, then press send.'
  })
  const recipients = whatsappRecipients(receipt.members)
  const button = (onClick?: () => void, disabled = false) => (
    <Button
      color="green"
      variant="light"
      leftSection={<IconBrandWhatsapp size={16} />}
      loading={send.isPending}
      disabled={disabled}
      onClick={onClick}
    >
      WhatsApp
    </Button>
  )

  if (recipients.length === 1) return button(() => send.mutate([{ memberId: recipients[0].id }]))
  if (recipients.length > 1) {
    return (
      <Menu position="top-start" withinPortal>
        <Menu.Target>{button()}</Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Send to</Menu.Label>
          {recipients.map((m) => (
            <Menu.Item key={m.id} onClick={() => send.mutate([{ memberId: m.id }])}>
              {fullName(m)} · {m.mobileNumber}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    )
  }
  // A store sale, or a member whose number can't be used: type or correct one.
  const member = receipt.members[0]
  return (
    <Stack gap={4}>
      {member && (
        <Text size="xs" c="orange.8" maw={340}>
          {stored
            ? `${member.firstName}'s saved number isn't a valid mobile number (a foreign one needs + and the country code). Correct it here to send, and fix it in their details.`
            : `${member.firstName} has no mobile number saved. Type one to send.`}
        </Text>
      )}
      <Group gap="xs" wrap="nowrap">
        <TextInput
          placeholder="WhatsApp number"
          aria-label="WhatsApp number"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          error={phone.trim() !== '' && !whatsappNumber(phone)}
          w={170}
        />
        {button(() => send.mutate([{ phone }]), !whatsappNumber(phone))}
      </Group>
    </Stack>
  )
}

function ReceiptView({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const { data: r, error } = useQuery({ queryKey: ['receipt', paymentId], queryFn: () => api.receipts.get(paymentId) })
  const print = useAction(() => api.receipts.print(paymentId))
  if (error) return <Text c="red">{error.message}</Text>
  if (!r) {
    return (
      <Center h={160}>
        <Loader />
      </Center>
    )
  }
  const rows: [string, string, string?][] = [[`Paid (${PAYMENT_TYPE_LABELS[r.method]})`, lkr(r.amount)]]
  if (r.registration) {
    const { total, joiningFee } = r.registration
    rows.push(
      ...(joiningFee > 0
        ? ([
            ['Plan', lkr(total - joiningFee)],
            ['Joining fee', lkr(joiningFee)],
            ['Total', lkr(total)]
          ] as [string, string][])
        : ([['Plan total', lkr(total)]] as [string, string][])),
      ['Paid to date', lkr(r.registration.paid)],
      ['Balance to pay', lkr(r.registration.balance), r.registration.balance > 0 ? 'red' : undefined]
    )
  }
  return (
    <Stack>
      <Group justify="space-between" align="baseline">
        <Title order={3}>{r.number ? `Receipt ${r.number}` : 'Receipt'}</Title>
        <Text size="sm" c="dimmed">
          {r.paidAt ? longDateTime(r.paidAt) : ''}
        </Text>
      </Group>
      <Stack gap={2}>
        {r.members.length > 0 && <Text size="sm">{r.members.map(fullName).join(', ')}</Text>}
        <Text fw={600}>{r.item}</Text>
        {r.detail && (
          <Text size="sm" c="dimmed">
            {r.detail}
          </Text>
        )}
      </Stack>
      <Table verticalSpacing={4}>
        <Table.Tbody>
          {rows.map(([label, value, color], i) => (
            <Table.Tr key={label}>
              <Table.Td fw={i === 0 ? 700 : undefined}>{label}</Table.Td>
              <Table.Td ta="right" fw={i === 0 ? 700 : undefined} c={color}>
                {value}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <SendOnWhatsApp receipt={r} />
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPrinter size={16} />} loading={print.isPending} onClick={() => print.mutate([])}>
            Print
          </Button>
          <Button onClick={onDone}>Done</Button>
        </Group>
      </Group>
    </Stack>
  )
}

/** Shows a payment's receipt, to send on WhatsApp or print. */
export function ReceiptProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ paymentId: string; justPaid: boolean } | null>(null)
  return (
    <ReceiptContext.Provider value={{ showReceipt: (paymentId, justPaid = false) => setShown({ paymentId, justPaid }) }}>
      {children}
      <Modal
        opened={shown !== null}
        onClose={() => setShown(null)}
        title={shown?.justPaid ? 'Payment recorded' : 'Receipt'}
        size="lg"
      >
        {shown && <ReceiptView key={shown.paymentId} paymentId={shown.paymentId} onDone={() => setShown(null)} />}
      </Modal>
    </ReceiptContext.Provider>
  )
}

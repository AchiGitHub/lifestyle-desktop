import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Divider,
  Drawer,
  Group,
  Loader,
  Menu,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title
} from '@mantine/core'
import { modals } from '@mantine/modals'
import {
  IconBrandWhatsapp,
  IconCash,
  IconDoorEnter,
  IconDots,
  IconEdit,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconTrash
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Member, Registration } from '@shared/api'
import { GENDER_LABELS, PAYMENT_CATEGORY_LABELS, PAYMENT_TYPE_LABELS } from '@shared/enums'
import { api, useAction } from '../lib/api'
import { formatDate, formatDateTime, fromNow, fullName, lkr, oneDecimal } from '../lib/format'
import { useDeskCheckIn } from './checkIns'
import { MemberFormModal } from './MemberFormModal'
import { useReceipt } from './ReceiptDialog'
import { AddPaymentModal, EditRegistrationModal } from './RegistrationModals'
import { MemberBadge, RegistrationBadge } from './StatusBadge'
import { useSendReminder, whatsappRecipients } from './WhatsAppButton'

const DrawerContext = createContext<{ openMember: (id: string) => void; closeMember: () => void }>({
  openMember: () => undefined,
  closeMember: () => undefined
})
export const useMemberDrawer = () => useContext(DrawerContext)

/** Navigate away from the drawer, closing it first. */
function useLeaveTo() {
  const navigate = useNavigate()
  const { closeMember } = useMemberDrawer()
  return (path: string) => {
    closeMember()
    navigate(path)
  }
}

function age(dob: string | null): string {
  if (!dob) return '—'
  const born = new Date(dob)
  const now = new Date()
  let years = now.getFullYear() - born.getFullYear()
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) years--
  return `${formatDate(dob)} (${years})`
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm">{value || '—'}</Text>
    </Stack>
  )
}

function RegistrationCard({
  registration: r,
  memberId,
  onAddPayment,
  onEdit
}: {
  registration: Registration
  memberId: string
  onAddPayment: () => void
  onEdit: () => void
}) {
  const leaveTo = useLeaveTo()
  const remove = useAction((id: string) => api.registrations.delete([id]), { success: 'Registration deleted' })
  const sendReminder = useSendReminder()
  const others = r.members.filter((m) => m.id !== memberId)
  // This member if their number works, otherwise whoever else on the registration can be reached.
  const recipients = whatsappRecipients(r.members)
  const recipient = recipients.find((m) => m.id === memberId) ?? recipients[0]
  return (
    <Paper p="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={600}>{r.membershipTypeName}</Text>
            <RegistrationBadge registration={r} />
          </Group>
          <Text size="sm" c="dimmed">
            {formatDate(r.startDate)} → {formatDate(r.endDate)}
            {others.length > 0 && ` · with ${others.map(fullName).join(', ')}`}
          </Text>
          <Text size="sm">
            {lkr(r.amount)}
            {r.joiningFee > 0 && ` (incl. joining fee ${lkr(r.joiningFee)})`} · paid {lkr(r.paid)}
            {r.balance > 0 && (
              <Text span c="red" fw={600}>
                {' '}
                · owes {lkr(r.balance)}
              </Text>
            )}
          </Text>
        </Stack>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Registration actions">
              <IconDots size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconCash size={16} />} onClick={onAddPayment}>
              Add payment
            </Menu.Item>
            {r.balance > 0 && (
              <Menu.Item
                leftSection={<IconBrandWhatsapp size={16} />}
                disabled={!recipient}
                title={recipient ? undefined : 'No mobile number that works with WhatsApp'}
                onClick={() => recipient && sendReminder.mutate([r.id, recipient.id, 'BALANCE'])}
              >
                WhatsApp payment reminder
              </Menu.Item>
            )}
            <Menu.Item leftSection={<IconRefresh size={16} />} onClick={() => leaveTo(`/registrations/new?renew=${r.id}`)}>
              Renew
            </Menu.Item>
            <Menu.Item leftSection={<IconPencil size={16} />} onClick={onEdit}>
              Edit
            </Menu.Item>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={16} />}
              disabled={r.paid > 0}
              title={r.paid > 0 ? 'Registrations with payments can’t be deleted' : undefined}
              onClick={() =>
                modals.openConfirmModal({
                  title: 'Delete this registration?',
                  children: <Text size="sm">It has no payments. This can’t be undone.</Text>,
                  labels: { confirm: 'Delete', cancel: 'Cancel' },
                  confirmProps: { color: 'red' },
                  onConfirm: () => remove.mutate([r.id])
                })
              }
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Paper>
  )
}

function MemberDetailView({ id, onOpenMember }: { id: string; onOpenMember: (id: string) => void }) {
  const leaveTo = useLeaveTo()
  const { data, isPending, error } = useQuery({ queryKey: ['member', id], queryFn: () => api.members.get(id) })
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState<Registration | null>(null)
  const [editingReg, setEditingReg] = useState<Registration | null>(null)
  const deletePayment = useAction((pid: string) => api.payments.delete(pid), { success: 'Payment deleted' })
  const { showReceipt } = useReceipt()
  const checkIn = useDeskCheckIn()

  if (isPending) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }
  if (error) return <Text c="red">{error.message}</Text>

  const { member, registrations, payments } = data
  const latest = registrations.reduce<Registration | null>((a, r) => (!a || r.endDate > a.endDate ? r : a), null)
  const owed = registrations.reduce((sum, r) => sum + r.balance, 0)

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={3}>{fullName(member)}</Title>
          <Group gap="xs">
            <MemberBadge lastEndDate={latest?.endDate ?? null} />
            {owed > 0 && (
              <Badge color="red" variant="filled">
                Owes {lkr(owed)}
              </Badge>
            )}
          </Group>
        </Stack>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconDoorEnter size={16} />} onClick={() => void checkIn(member.id)}>
            Check in
          </Button>
          <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            leftSection={latest ? <IconRefresh size={16} /> : <IconPlus size={16} />}
            onClick={() =>
              leaveTo(latest ? `/registrations/new?renew=${latest.id}` : `/registrations/new?member=${member.id}`)
            }
          >
            {latest ? 'Renew' : 'Register'}
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={3} spacing="md" verticalSpacing="sm">
        <Detail label="Mobile" value={member.mobileNumber} />
        <Detail label="Other number" value={member.secondaryNumber} />
        <Detail label="NIC" value={member.nic} />
        <Detail label="Date of birth" value={age(member.dob)} />
        <Detail label="Gender" value={GENDER_LABELS[member.gender]} />
        <Detail label="Occupation" value={member.occupation} />
        <Detail label="Height" value={member.height ? `${oneDecimal(member.height)} cm` : null} />
        <Detail label="Weight" value={member.weight ? `${oneDecimal(member.weight)} kg` : null} />
        <Detail label="Member since" value={formatDate(member.createdAt)} />
        <Detail
          label="Last visit"
          value={
            data.visits.lastAt
              ? `${fromNow(data.visits.lastAt)} · ${data.visits.last30Days} in the last 30 days`
              : 'No check-ins yet'
          }
        />
      </SimpleGrid>
      <Detail label="Address" value={member.address} />

      <Divider label={`Registrations (${registrations.length})`} labelPosition="left" />
      <Stack gap="xs">
        {registrations.length === 0 && (
          <Text size="sm" c="dimmed">
            No registrations yet.
          </Text>
        )}
        {registrations.map((r) => (
          <RegistrationCard
            key={r.id}
            registration={r}
            memberId={member.id}
            onAddPayment={() => setPaying(r)}
            onEdit={() => setEditingReg(r)}
          />
        ))}
      </Stack>

      <Divider label={`Payments (${payments.length})`} labelPosition="left" />
      {payments.length === 0 ? (
        <Text size="sm" c="dimmed">
          No payments yet.
        </Text>
      ) : (
        <Table striped verticalSpacing={6}>
          <Table.Tbody>
            {payments.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{formatDateTime(p.paidAt)}</Table.Td>
                <Table.Td>{PAYMENT_CATEGORY_LABELS[p.category]}</Table.Td>
                <Table.Td>{PAYMENT_TYPE_LABELS[p.paymentType]}</Table.Td>
                <Table.Td ta="right" fw={600}>
                  {lkr(p.amount)}
                </Table.Td>
                <Table.Td w={40}>
                  <ActionIcon variant="subtle" color="gray" aria-label="Receipt" onClick={() => showReceipt(p.id)}>
                    <IconReceipt size={16} />
                  </ActionIcon>
                </Table.Td>
                <Table.Td w={40}>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="Delete payment"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: 'Delete this payment?',
                        children: (
                          <Text size="sm">
                            {lkr(p.amount)} on {formatDateTime(p.paidAt)}. Only do this to fix a mistake.
                          </Text>
                        ),
                        labels: { confirm: 'Delete payment', cancel: 'Cancel' },
                        confirmProps: { color: 'red' },
                        onConfirm: () => deletePayment.mutate([p.id])
                      })
                    }
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <MemberFormModal
        opened={editing}
        onClose={() => setEditing(false)}
        member={member}
        onOpenExisting={(m: Member) => onOpenMember(m.id)}
      />
      <AddPaymentModal registration={paying} onClose={() => setPaying(null)} />
      <EditRegistrationModal registration={editingReg} onClose={() => setEditingReg(null)} />
    </Stack>
  )
}

export function MemberDrawerProvider({ children }: { children: ReactNode }) {
  const [memberId, setMemberId] = useState<string | null>(null)
  return (
    <DrawerContext.Provider value={{ openMember: setMemberId, closeMember: () => setMemberId(null) }}>
      {children}
      <Drawer
        opened={memberId !== null}
        onClose={() => setMemberId(null)}
        position="right"
        size={680}
        title="Member"
        padding="lg"
      >
        {memberId && <MemberDetailView key={memberId} id={memberId} onOpenMember={setMemberId} />}
      </Drawer>
    </DrawerContext.Provider>
  )
}

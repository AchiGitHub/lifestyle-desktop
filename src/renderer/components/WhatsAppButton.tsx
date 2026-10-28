import { Button, Menu, Tooltip } from '@mantine/core'
import { IconBrandWhatsapp, IconCheck } from '@tabler/icons-react'
import type { Registration, RegistrationMember } from '@shared/api'
import { todayIso } from '@shared/dates'
import type { ReminderKind } from '@shared/enums'
import { whatsappNumber } from '@shared/reminders'
import { api, useAction } from '../lib/api'
import { formatDateTime, fromNow, fullName } from '../lib/format'

/** Members with a usable number, one per number (couples often share a phone). */
export function whatsappRecipients(members: RegistrationMember[]): RegistrationMember[] {
  const seen = new Set<string>()
  return members.filter((m) => {
    const number = whatsappNumber(m.mobileNumber)
    if (!number || seen.has(number)) return false
    seen.add(number)
    return true
  })
}

export function useSendReminder() {
  return useAction(
    (registrationId: string, memberId: string, kind: ReminderKind) =>
      api.reminders.send({ registrationId, memberId, kind }),
    { success: 'Opening WhatsApp. Check the message, then press send.' }
  )
}

/** Renewal reminder for the Renewals due and Not renewed lists. */
export function WhatsAppButton({ registration: r }: { registration: Registration }) {
  const send = useSendReminder()
  const kind: ReminderKind = r.endDate < todayIso() ? 'EXPIRED' : 'EXPIRING'
  const recipients = whatsappRecipients(r.members)
  const messaged = r.remindedAt !== null

  const button = (onClick?: () => void) => (
    <Button
      size="xs"
      variant={messaged ? 'subtle' : 'light'}
      color="green"
      leftSection={messaged ? <IconCheck size={14} /> : <IconBrandWhatsapp size={14} />}
      loading={send.isPending}
      data-disabled={recipients.length === 0 || undefined}
      onClick={recipients.length === 0 ? (e) => e.preventDefault() : onClick}
    >
      {messaged ? 'Messaged' : 'WhatsApp'}
    </Button>
  )

  if (recipients.length === 0) {
    return <Tooltip label="No mobile number that works with WhatsApp">{button()}</Tooltip>
  }
  const lastSent = messaged ? `Messaged ${fromNow(r.remindedAt!)} (${formatDateTime(r.remindedAt)})` : null

  if (recipients.length === 1) {
    return (
      <Tooltip label={lastSent ? `${lastSent}. Click to message again.` : 'Open WhatsApp with a reminder typed in'} multiline maw={260}>
        {button(() => send.mutate([r.id, recipients[0].id, kind]))}
      </Tooltip>
    )
  }
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>{button()}</Menu.Target>
      <Menu.Dropdown>
        {lastSent && <Menu.Label>{lastSent}</Menu.Label>}
        <Menu.Label>Send to</Menu.Label>
        {recipients.map((m) => (
          <Menu.Item key={m.id} onClick={() => send.mutate([r.id, m.id, kind])}>
            {fullName(m)} · {m.mobileNumber}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

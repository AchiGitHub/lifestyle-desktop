import {
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import { IconBrandWhatsapp, IconCheck } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Registration, RegistrationMember } from '@shared/api'
import { todayIso } from '@shared/dates'
import type { ReminderKind } from '@shared/enums'
import { fillTemplate, reminderValues, whatsappNumber } from '@shared/reminders'
import { api, useAction } from '../lib/api'
import { formatDateTime, fromNow, fullName, lkr } from '../lib/format'
import { useMembershipTypes } from '../lib/queries'

const MAX_PACKAGES = 8

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

type RegistrationReminderKind = Exclude<ReminderKind, 'CREDIT'>

export function useSendReminder() {
  return useAction(
    (registrationId: string, memberId: string, kind: RegistrationReminderKind, packageIds?: string[]) =>
      api.reminders.send({ registrationId, memberId, kind, packageIds }),
    { success: 'Opening WhatsApp. Check the message, then press send.' }
  )
}

/** Who to message and which packages to offer, with the message exactly as it will be typed in. */
function ReminderDialog({
  registration: r,
  kind,
  recipients,
  onClose
}: {
  registration: Registration
  kind: RegistrationReminderKind
  recipients: RegistrationMember[]
  onClose: () => void
}) {
  const { data: settings } = useQuery({ queryKey: ['reminderSettings'], queryFn: () => api.reminders.settings() })
  const { data: plans } = useMembershipTypes()
  const send = useSendReminder()
  const [memberId, setMemberId] = useState(recipients[0].id)
  const [picked, setPicked] = useState<string[] | null>(null)

  // Start from the packages ticked by default in Settings (or the most popular).
  useEffect(() => {
    if (settings && picked === null) {
      setPicked(settings.packageIds.length > 0 ? settings.packageIds : settings.popularPackageIds)
    }
  }, [settings, picked])

  const title = kind === 'EXPIRED' ? 'Ask them back on WhatsApp' : 'Renewal reminder on WhatsApp'
  if (!settings || !plans || picked === null) {
    return (
      <Modal opened onClose={onClose} title={title}>
        <Center py="xl">
          <Loader />
        </Center>
      </Modal>
    )
  }

  const template = settings.templates[kind]
  const usesPackages = template.includes('{packages}')
  const offered = plans.filter((p) => !p.archived).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
  const ticked = picked.filter((id) => offered.some((p) => p.id === id))
  const member = recipients.find((m) => m.id === memberId) ?? recipients[0]
  const text = fillTemplate(
    template,
    reminderValues({
      firstName: member.firstName,
      plan: r.membershipTypeName,
      endDate: r.endDate,
      balance: r.balance,
      packages: offered.filter((p) => ticked.includes(p.id))
    })
  )
  const missingPackages = usesPackages && ticked.length === 0

  return (
    <Modal opened onClose={onClose} title={title} size={usesPackages ? 'xl' : 'md'}>
      <Stack>
        {recipients.length > 1 && (
          <Group gap="sm">
            <Text size="sm" fw={600}>
              Send to
            </Text>
            <SegmentedControl
              value={memberId}
              onChange={setMemberId}
              data={recipients.map((m) => ({ value: m.id, label: fullName(m) }))}
            />
          </Group>
        )}
        <SimpleGrid cols={usesPackages ? 2 : 1} spacing="lg">
          {usesPackages && (
            <div>
              <Text size="sm" fw={600}>
                Packages to offer
              </Text>
              <Text size="xs" c="dimmed" mb="xs">
                Up to {MAX_PACKAGES}, listed cheapest first in the message.
              </Text>
              <ScrollArea.Autosize mah={260} type="auto" offsetScrollbars>
                <Checkbox.Group value={ticked} onChange={setPicked}>
                  <Stack gap={8}>
                    {offered.map((p) => (
                      <Checkbox
                        key={p.id}
                        value={p.id}
                        disabled={!ticked.includes(p.id) && ticked.length >= MAX_PACKAGES}
                        label={
                          <>
                            {p.name} – {lkr(p.price)}
                            {p.id === r.membershipTypeId && (
                              <Text span size="xs" c="dimmed">
                                {' '}
                                · their plan
                              </Text>
                            )}
                          </>
                        }
                      />
                    ))}
                  </Stack>
                </Checkbox.Group>
              </ScrollArea.Autosize>
            </div>
          )}
          <div>
            <Text size="sm" fw={600} mb="xs">
              Message to {fullName(member)}
            </Text>
            <Paper withBorder p="sm" bg="var(--app-muted-bg)">
              <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                {text}
              </Text>
            </Paper>
            <Text size="xs" c="dimmed" mt={4}>
              WhatsApp opens with this typed in. You can still change it there before pressing send.
            </Text>
          </div>
        </SimpleGrid>
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c={missingPackages ? 'var(--app-orange-text)' : 'dimmed'}>
            {missingPackages
              ? 'Tick at least one package.'
              : usesPackages
                ? 'Which are ticked to start with is set in Settings → WhatsApp reminders.'
                : ''}
          </Text>
          <Group gap="sm" wrap="nowrap">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              color="green"
              leftSection={<IconBrandWhatsapp size={16} />}
              loading={send.isPending}
              disabled={missingPackages}
              onClick={() =>
                send.mutate([r.id, member.id, kind, usesPackages ? ticked : undefined], { onSuccess: onClose })
              }
            >
              Open WhatsApp
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Renewal reminder for the Renewals due and Not renewed lists. */
export function WhatsAppButton({ registration: r }: { registration: Registration }) {
  const [open, setOpen] = useState(false)
  const kind: RegistrationReminderKind = r.endDate < todayIso() ? 'EXPIRED' : 'EXPIRING'
  const recipients = whatsappRecipients(r.members)
  const messaged = r.remindedAt !== null
  const lastSent = messaged ? `Messaged ${fromNow(r.remindedAt!)} (${formatDateTime(r.remindedAt)})` : null

  const button = (
    <Button
      size="xs"
      variant={messaged ? 'subtle' : 'light'}
      color="green"
      leftSection={messaged ? <IconCheck size={14} /> : <IconBrandWhatsapp size={14} />}
      data-disabled={recipients.length === 0 || undefined}
      onClick={recipients.length === 0 ? (e) => e.preventDefault() : () => setOpen(true)}
    >
      {messaged ? 'Messaged' : 'WhatsApp'}
    </Button>
  )

  return (
    <>
      <Tooltip
        label={
          recipients.length === 0
            ? 'No mobile number that works with WhatsApp'
            : lastSent
              ? `${lastSent}. Click to message again.`
              : 'Choose the packages to offer, then open WhatsApp with the reminder typed in'
        }
        multiline
        maw={260}
      >
        {button}
      </Tooltip>
      {open && <ReminderDialog registration={r} kind={kind} recipients={recipients} onClose={() => setOpen(false)} />}
    </>
  )
}

import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  MultiSelect,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title
} from '@mantine/core'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import {
  IconBrandGoogleDrive,
  IconBrandWhatsapp,
  IconCloudUpload,
  IconDeviceMobile,
  IconDeviceTablet,
  IconFileImport,
  IconInfoCircle,
  IconPrinter,
  IconReceipt
} from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import type { ReceiptSettings, ReminderSettings } from '@shared/api'
import { addDays, todayIso } from '@shared/dates'
import { REMINDER_KIND_LABELS, REMINDER_KINDS, type ReminderKind } from '@shared/enums'
import { DEFAULT_TEMPLATES, fillTemplate, reminderValues, type PackagePrice } from '@shared/reminders'
import {
  passwordInput,
  receiptSettingsInput,
  reminderSettingsInput,
  type ReceiptSettingsInput,
  type ReminderSettingsInput
} from '@shared/schemas'
import { AppearanceCard } from '../components/AppearanceCard'
import { LanDevicesCard } from '../components/LanDevicesCard'
import { OwnerSummaryCard } from '../components/OwnerSummaryCard'
import { PageHeader } from '../components/PageHeader'
import { TrainersCard } from '../components/TrainersCard'
import { UpdatesCard } from '../components/Updates'
import { api, notifyError, notifySuccess, useAction } from '../lib/api'
import { fileSize, formatDateTime, fromNow, lkr } from '../lib/format'
import { useBackupStatus, useMembershipTypes } from '../lib/queries'

const changePassword = z
  .object({ current: z.string().min(1, 'Enter the current password'), next: passwordInput, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: 'The passwords don’t match', path: ['confirm'] })

function PasswordCard() {
  const form = useForm({
    initialValues: { current: '', next: '', confirm: '' },
    validate: schemaResolver(changePassword, { sync: true })
  })
  const save = useAction((current: string, next: string) => api.auth.changePassword(current, next), {
    success: 'Password changed'
  })
  return (
    <Paper p="lg">
      <Title order={4} mb="md">
        Password
      </Title>
      <form onSubmit={form.onSubmit((v) => save.mutate([v.current, v.next], { onSuccess: () => form.reset() }))}>
        <Group align="flex-end">
          <PasswordInput label="Current password" w={220} {...form.getInputProps('current')} />
          <PasswordInput label="New password" w={220} {...form.getInputProps('next')} />
          <PasswordInput label="New password again" w={220} {...form.getInputProps('confirm')} />
          <Button type="submit" loading={save.isPending}>
            Change password
          </Button>
        </Group>
      </form>
    </Paper>
  )
}

/** Restore replaces everything, then signs out: the restored data has its own password. */
function useRestore() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const run = (key: string, label: string, fn: () => Promise<unknown>) =>
    modals.openConfirmModal({
      title: 'Replace all data with this backup?',
      children: (
        <Text size="sm">
          Everything in the app will be replaced with the backup from <b>{label}</b>. A safety copy of the current
          data is saved first, so this can be undone from the local backups list. You’ll need to sign in again.
        </Text>
      ),
      labels: { confirm: 'Restore', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        setBusy(key)
        try {
          const result = await fn()
          if (result !== false) {
            notifySuccess('Backup restored. Please sign in.')
            await queryClient.invalidateQueries()
          }
        } catch (e) {
          notifyError(e, 'Restore failed')
        } finally {
          setBusy(null)
        }
      }
    })
  return { busy, run }
}

function DriveCard() {
  const { data: status } = useBackupStatus()
  const [showList, setShowList] = useState(false)
  const driveList = useQuery({
    queryKey: ['driveBackups'],
    queryFn: () => api.backup.listDriveBackups(),
    enabled: showList && Boolean(status?.driveConnected)
  })
  const connect = useAction(() => api.backup.connectDrive(), { success: 'Google Drive connected' })
  const disconnect = useAction(() => api.backup.disconnectDrive(), { success: 'Google Drive disconnected' })
  const backup = useAction(() => api.backup.backupNow(), { success: 'Backed up to Google Drive' })
  const restore = useRestore()
  if (!status) return null

  return (
    <Paper p="lg">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconBrandGoogleDrive />
          <Title order={4}>Google Drive backup</Title>
        </Group>
        {status.driveConnected && <Badge color="teal">Connected</Badge>}
      </Group>

      {!status.driveConfigured ? (
        <Alert color="gray" icon={<IconInfoCircle />}>
          This build of the app has no Google sign-in configured. Add <Code>MAIN_VITE_GOOGLE_CLIENT_ID</Code> and{' '}
          <Code>MAIN_VITE_GOOGLE_CLIENT_SECRET</Code> to <Code>.env</Code> and rebuild (see the README).
        </Alert>
      ) : !status.driveConnected ? (
        <Stack align="flex-start">
          <Text size="sm">
            Connect the gym’s Google account. A copy of the data is uploaded once a day and when the app closes, to a
            “Lifestyle Backups” folder. The app can only see the files it creates there.
          </Text>
          <Button loading={connect.isPending} onClick={() => connect.mutate([])}>
            Connect Google Drive
          </Button>
          {connect.isPending && (
            <Text size="xs" c="dimmed">
              Finish signing in in your browser, making sure the Google Drive box is ticked, then come back here.
            </Text>
          )}
        </Stack>
      ) : (
        <Stack>
          <Group gap="xl">
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                Account
              </Text>
              <Text size="sm">{status.driveAccount ?? 'Connected'}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                Last backup
              </Text>
              <Text size="sm">
                {status.lastBackupAt
                  ? `${formatDateTime(status.lastBackupAt)} (${fromNow(status.lastBackupAt)})`
                  : 'Not yet'}
              </Text>
            </Stack>
          </Group>
          {status.lastError && (
            <Alert color="orange" title="The last backup attempt failed">
              {status.lastError}
            </Alert>
          )}
          <Group>
            <Button
              leftSection={<IconCloudUpload size={16} />}
              loading={backup.isPending || status.running}
              onClick={() => backup.mutate([])}
            >
              Back up now
            </Button>
            <Button variant="default" onClick={() => setShowList((v) => !v)}>
              {showList ? 'Hide backups in Drive' : 'Show backups in Drive'}
            </Button>
            <Button
              variant="subtle"
              color="red"
              loading={disconnect.isPending}
              onClick={() =>
                modals.openConfirmModal({
                  title: 'Disconnect Google Drive?',
                  children: <Text size="sm">Backups stop until you connect again. Files already in Drive stay there.</Text>,
                  labels: { confirm: 'Disconnect', cancel: 'Cancel' },
                  confirmProps: { color: 'red' },
                  onConfirm: () => disconnect.mutate([])
                })
              }
            >
              Disconnect
            </Button>
          </Group>
          {showList &&
            (driveList.isPending ? (
              <Text size="sm">Loading…</Text>
            ) : driveList.error ? (
              <Alert color="red">{driveList.error.message}</Alert>
            ) : (
              <Table verticalSpacing={6}>
                <Table.Tbody>
                  {driveList.data.map((b) => (
                    <Table.Tr key={b.id}>
                      <Table.Td>{formatDateTime(b.createdTime)}</Table.Td>
                      <Table.Td c="dimmed">{fileSize(b.size)}</Table.Td>
                      <Table.Td ta="right">
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          loading={restore.busy === b.id}
                          onClick={() =>
                            restore.run(b.id, formatDateTime(b.createdTime), () => api.backup.restoreFromDrive(b.id))
                          }
                        >
                          Restore
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ))}
        </Stack>
      )}
    </Paper>
  )
}

function LocalCard() {
  const { data: status } = useBackupStatus()
  const restore = useRestore()
  if (!status) return null
  return (
    <Paper p="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Backups on this computer</Title>
        <Button
          variant="default"
          leftSection={<IconFileImport size={16} />}
          loading={restore.busy === 'file'}
          onClick={() => restore.run('file', 'a file you choose', () => api.backup.restoreFromFile())}
        >
          Restore from file…
        </Button>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        A copy is kept each day for two weeks, plus one before every restore. These don’t help if the computer itself
        fails, which is what the Google Drive backup is for.
      </Text>
      {status.localBackups.length === 0 ? (
        <Text size="sm" c="dimmed">
          None yet.
        </Text>
      ) : (
        <Table verticalSpacing={6}>
          <Table.Tbody>
            {status.localBackups.map((b) => (
              <Table.Tr key={b.name}>
                <Table.Td>{formatDateTime(b.createdAt)}</Table.Td>
                <Table.Td>
                  <Badge
                    variant="light"
                    color={b.name.includes('before-restore') ? 'orange' : b.name.includes('before-update') ? 'blue' : 'gray'}
                  >
                    {b.name.includes('before-restore')
                      ? 'Before restore'
                      : b.name.includes('before-update')
                        ? 'Before update'
                        : 'Daily'}
                  </Badge>
                </Table.Td>
                <Table.Td c="dimmed">{fileSize(b.size)}</Table.Td>
                <Table.Td ta="right">
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    loading={restore.busy === b.name}
                    onClick={() =>
                      restore.run(b.name, formatDateTime(b.createdAt), () => api.backup.restoreLocal(b.name))
                    }
                  >
                    Restore
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text size="xs" c="dimmed" mt="md">
        Database file: <Code>{status.dbPath}</Code>
      </Text>
    </Paper>
  )
}

const exampleItems = [
  { soldAt: addDays(todayIso(), -12), productName: 'Yeti Isotonic', quantity: 2, amount: 700, owed: 700 },
  { soldAt: addDays(todayIso(), -3), productName: 'Whey Protein 1kg', quantity: 1, amount: 12000, owed: 12000 }
]

const example = (kind: ReminderKind, packages: PackagePrice[]) =>
  reminderValues({
    firstName: 'Nimal',
    plan: 'One Month',
    endDate: addDays(todayIso(), kind === 'EXPIRED' ? -5 : 5),
    balance: kind === 'CREDIT' ? 12700 : 5000,
    packages,
    items: exampleItems
  })

function RemindersForm({ settings }: { settings: ReminderSettings }) {
  const { data: plans = [] } = useMembershipTypes()
  const form = useForm<ReminderSettingsInput>({
    initialValues: { templates: settings.templates, packageIds: settings.packageIds },
    validate: schemaResolver(reminderSettingsInput, { sync: true })
  })
  const save = useAction((input: ReminderSettingsInput) => api.reminders.save(input), { success: 'Messages saved' })
  const chosen = form.values.packageIds
  const listedIds = chosen.length > 0 ? chosen : settings.popularPackageIds
  const listed = plans.filter((p) => listedIds.includes(p.id))
  return (
    <Paper p="lg">
      <Group gap="xs" mb="md">
        <IconBrandWhatsapp />
        <Title order={4}>WhatsApp reminders</Title>
      </Group>
      <Text size="sm" mb="md">
        The WhatsApp buttons on Renewals due, Not renewed, On credit and a member’s unpaid registration open a chat with
        one of these messages typed in; check it, then press send. <Code>{'{name}'}</Code>, <Code>{'{plan}'}</Code>,{' '}
        <Code>{'{endDate}'}</Code> and <Code>{'{balance}'}</Code> are filled in for each member, and{' '}
        <Code>{'{packages}'}</Code> becomes a price list of the packages ticked when the reminder is sent. In the store
        credit message, <Code>{'{balance}'}</Code> is what they owe and <Code>{'{items}'}</Code> lists the items.
      </Text>
      {!settings.whatsappDesktop && (
        <Alert color="gray" icon={<IconInfoCircle />} mb="md">
          WhatsApp isn’t installed on this computer, so messages open in WhatsApp Web in the browser. Installing
          WhatsApp from the Microsoft Store, linked to the gym’s phone, is quicker.
        </Alert>
      )}
      <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: () => form.resetDirty(v) }))}>
        <Stack>
          <MultiSelect
            label="Packages ticked to start with"
            description="Staff choose the packages each time they send a renewal reminder; these are ticked to begin with. Leave empty to tick the 5 most popular plans of the last 12 months."
            placeholder={chosen.length === 0 ? 'The 5 most popular plans' : undefined}
            data={plans.filter((p) => !p.archived).map((p) => ({ value: p.id, label: `${p.name} – ${lkr(p.price)}` }))}
            searchable
            clearable
            {...form.getInputProps('packageIds')}
          />
          {REMINDER_KINDS.map((kind) => (
            <Textarea
              key={kind}
              label={REMINDER_KIND_LABELS[kind]}
              autosize
              minRows={2}
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              description={`Example: ${fillTemplate(form.values.templates[kind], example(kind, listed))}`}
              styles={{ description: { whiteSpace: 'pre-line' } }}
              {...form.getInputProps(`templates.${kind}`)}
            />
          ))}
          <Group>
            <Button type="submit" loading={save.isPending} disabled={!form.isDirty()}>
              Save messages
            </Button>
            <Button variant="subtle" color="gray" onClick={() => form.setFieldValue('templates', DEFAULT_TEMPLATES)}>
              Use the default messages
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  )
}

function ReceiptsForm({ settings }: { settings: ReceiptSettings }) {
  const form = useForm<ReceiptSettingsInput>({
    initialValues: settings,
    validate: schemaResolver(receiptSettingsInput, { sync: true })
  })
  const save = useAction((input: ReceiptSettingsInput) => api.receipts.saveSettings(input), { success: 'Saved' })
  const sample = useAction(() => api.receipts.printSample())
  return (
    <Paper p="lg">
      <Group gap="xs" mb="md">
        <IconReceipt />
        <Title order={4}>Receipts</Title>
      </Group>
      <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: () => form.resetDirty(v) }))}>
        <Stack>
          <SimpleGrid cols={2}>
            <TextInput label="Gym name" {...form.getInputProps('gymName')} />
            <TextInput label="Phone" placeholder="Shown under the name" {...form.getInputProps('phone')} />
            <TextInput label="Address" placeholder="Shown under the name" {...form.getInputProps('address')} />
            <TextInput label="Last line" placeholder="e.g. Thank you!" {...form.getInputProps('footer')} />
            <TextInput
              label="Owner’s WhatsApp number"
              description="Payments → By day sends a day’s summary here"
              placeholder="07X XXX XXXX"
              {...form.getInputProps('ownerPhone')}
            />
          </SimpleGrid>
          <Group>
            <Button type="submit" loading={save.isPending} disabled={!form.isDirty()}>
              Save
            </Button>
            <Button
              variant="default"
              leftSection={<IconPrinter size={16} />}
              loading={sample.isPending}
              onClick={() => sample.mutate([])}
            >
              Print a sample receipt
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  )
}

function ReceiptsCard() {
  const { data } = useQuery({ queryKey: ['receiptSettings'], queryFn: () => api.receipts.settings() })
  return data ? <ReceiptsForm settings={data} /> : null
}

function RemindersCard() {
  const { data } = useQuery({ queryKey: ['reminderSettings'], queryFn: () => api.reminders.settings() })
  return data ? <RemindersForm settings={data} /> : null
}

export function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <Stack>
        <DriveCard />
        <OwnerSummaryCard />
        <LocalCard />
        <RemindersCard />
        <ReceiptsCard />
        <TrainersCard />
        <LanDevicesCard
          group="doorTablet"
          title="Door check-in tablet"
          icon={<IconDeviceTablet />}
          noun="tablet"
          description="Members check themselves in on a tablet at the door, over the gym’s Wi-Fi. The tablet opens a page served by this computer, so this computer must be on with the app open."
        />
        <LanDevicesCard
          group="staffDevices"
          title="Instructor phones"
          icon={<IconDeviceMobile />}
          noun="phone"
          named
          description="Instructors record store sales and stock on their own phones, over the gym’s Wi-Fi. Each phone is paired under the instructor’s name, so every sale and stock change shows who made it. This computer must be on with the app open."
        />
        <AppearanceCard />
        <UpdatesCard />
        <PasswordCard />
      </Stack>
    </>
  )
}

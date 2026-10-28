import { Alert, Button, Group, PasswordInput, Stack, Table, Text, Title, UnstyledButton } from '@mantine/core'
import { schemaResolver, useForm } from '@mantine/form'
import { IconBrandGoogleDrive, IconFile, IconSparkles } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { z } from 'zod'
import { passwordInput } from '@shared/schemas'
import { api, notifyError } from '../lib/api'
import { fileSize, formatDateTime } from '../lib/format'
import { AuthScreen } from './AuthScreen'

const newPassword = z
  .object({ password: passwordInput, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The passwords don’t match', path: ['confirm'] })

function SetPassword({ intro }: { intro: ReactNode }) {
  const queryClient = useQueryClient()
  const form = useForm({
    initialValues: { password: '', confirm: '' },
    validate: schemaResolver(newPassword, { sync: true })
  })
  const [busy, setBusy] = useState(false)
  return (
    <form
      onSubmit={form.onSubmit(async ({ password }) => {
        setBusy(true)
        try {
          await api.auth.setPassword(password)
          await queryClient.invalidateQueries()
        } catch (e) {
          notifyError(e)
        } finally {
          setBusy(false)
        }
      })}
    >
      <Stack>
        <Title order={3}>Choose a password</Title>
        <Text size="sm" c="dimmed">
          {intro}
        </Text>
        <PasswordInput label="Password" autoFocus {...form.getInputProps('password')} />
        <PasswordInput label="Type it again" {...form.getInputProps('confirm')} />
        <Button type="submit" loading={busy}>
          Save password
        </Button>
      </Stack>
    </form>
  )
}

function Choice({
  icon,
  title,
  text,
  onClick,
  disabled = false
}: {
  icon: ReactNode
  title: string
  text: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      disabled={disabled}
      p="md"
      style={{
        border: '1px solid var(--mantine-color-gray-3)',
        borderRadius: 'var(--mantine-radius-md)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      <Group wrap="nowrap">
        {icon}
        <Stack gap={0}>
          <Text fw={600}>{title}</Text>
          <Text size="sm" c="dimmed">
            {text}
          </Text>
        </Stack>
      </Group>
    </UnstyledButton>
  )
}

function DriveRestore({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['backupStatus'], queryFn: () => api.backup.status() })
  const connected = status.data?.driveConnected
  const backups = useQuery({
    queryKey: ['driveBackups'],
    queryFn: () => api.backup.listDriveBackups(),
    enabled: Boolean(connected)
  })
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
      await queryClient.invalidateQueries()
    } catch (e) {
      notifyError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Stack>
      <Title order={3}>Restore from Google Drive</Title>
      {!connected ? (
        <>
          <Text size="sm" c="dimmed">
            Sign in with the Google account that holds the “Lifestyle Backups” folder. Your browser will open; make
            sure the Google Drive box is ticked before you press Continue.
          </Text>
          <Button loading={busy === 'connect'} onClick={() => run('connect', () => api.backup.connectDrive())}>
            Connect Google Drive
          </Button>
        </>
      ) : backups.isPending ? (
        <Text size="sm">Loading backups…</Text>
      ) : backups.error ? (
        <Alert color="red">{backups.error.message}</Alert>
      ) : backups.data.length === 0 ? (
        <Alert color="yellow">No backups found in this Google account.</Alert>
      ) : (
        <Table>
          <Table.Tbody>
            {backups.data.slice(0, 8).map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>{formatDateTime(b.createdTime)}</Table.Td>
                <Table.Td c="dimmed">{fileSize(b.size)}</Table.Td>
                <Table.Td ta="right">
                  <Button
                    size="xs"
                    loading={busy === b.id}
                    disabled={busy !== null && busy !== b.id}
                    onClick={() => run(b.id, () => api.backup.restoreFromDrive(b.id))}
                  >
                    Restore
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Button variant="subtle" onClick={onBack}>
        Back
      </Button>
    </Stack>
  )
}

export function FirstRun({ isEmpty }: { isEmpty: boolean }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'choose' | 'new' | 'drive'>('choose')
  const status = useQuery({ queryKey: ['backupStatus'], queryFn: () => api.backup.status() })

  if (!isEmpty) {
    return (
      <AuthScreen>
        <SetPassword intro="Your data is loaded. Set the password the front desk will use to open the app." />
      </AuthScreen>
    )
  }
  if (step === 'new') {
    return (
      <AuthScreen>
        <SetPassword intro="You’ll type this each time you open the app." />
      </AuthScreen>
    )
  }
  if (step === 'drive') {
    return (
      <AuthScreen width={480}>
        <DriveRestore onBack={() => setStep('choose')} />
      </AuthScreen>
    )
  }

  const restoreFile = async () => {
    try {
      if (await api.backup.restoreFromFile()) await queryClient.invalidateQueries()
    } catch (e) {
      notifyError(e, 'Couldn’t restore that file')
    }
  }

  return (
    <AuthScreen width={480}>
      <Stack>
        <Title order={3}>Welcome to Lifestyle</Title>
        <Text size="sm" c="dimmed">
          How do you want to start?
        </Text>
        <Choice
          icon={<IconBrandGoogleDrive size={28} />}
          title="Restore from Google Drive"
          text={
            status.data?.driveConfigured
              ? 'Moving to a new computer? Bring back the latest backup.'
              : 'Not available in this build.'
          }
          disabled={!status.data?.driveConfigured}
          onClick={() => setStep('drive')}
        />
        <Choice
          icon={<IconFile size={28} />}
          title="Restore from a file"
          text="Load a backup or migrated database (.db) from this computer or a USB drive."
          onClick={() => void restoreFile()}
        />
        <Choice
          icon={<IconSparkles size={28} />}
          title="Start fresh"
          text="Begin with an empty database."
          onClick={() => setStep('new')}
        />
      </Stack>
    </AuthScreen>
  )
}

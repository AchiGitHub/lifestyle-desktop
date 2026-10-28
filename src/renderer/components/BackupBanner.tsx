import { Alert, Button, Group, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useAction } from '../lib/api'
import { fromNow } from '../lib/format'
import { useBackupStatus } from '../lib/queries'

const OVERDUE_MS = 3 * 24 * 60 * 60 * 1000

/** Nags until backups are set up and working: this PC holds the only live copy of the data. */
export function BackupBanner() {
  const { data } = useBackupStatus()
  const [hidden, setHidden] = useState(false)
  const backup = useAction(() => api.backup.backupNow(), { success: 'Backed up to Google Drive' })
  if (!data || !data.driveConfigured || hidden) return null

  if (!data.driveConnected) {
    return (
      <Alert color="yellow" icon={<IconAlertTriangle />} mb="lg" withCloseButton onClose={() => setHidden(true)}>
        <Group justify="space-between">
          <Text size="sm">
            Google Drive backup isn’t set up. If this computer fails, the gym’s data is lost.
          </Text>
          <Button component={Link} to="/settings" size="xs" color="yellow">
            Set up backup
          </Button>
        </Group>
      </Alert>
    )
  }

  const last = data.lastBackupAt ? Date.parse(data.lastBackupAt) : 0
  if (Date.now() - last < OVERDUE_MS) return null
  return (
    <Alert color="orange" icon={<IconAlertTriangle />} mb="lg" withCloseButton onClose={() => setHidden(true)}>
      <Group justify="space-between">
        <Text size="sm">
          {data.lastBackupAt ? `The last successful backup was ${fromNow(data.lastBackupAt)}.` : 'No backup has worked yet.'}
          {data.lastError && ` Last error: ${data.lastError}`}
        </Text>
        <Button size="xs" color="orange" loading={backup.isPending} onClick={() => backup.mutate([])}>
          Back up now
        </Button>
      </Group>
    </Alert>
  )
}

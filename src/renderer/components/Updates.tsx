import { Badge, Button, Group, Paper, Text, Title, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconDownload, IconRefresh } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import type { UpdateStatus } from '@shared/api'
import { api, useAction } from '../lib/api'
import { fromNow } from '../lib/format'

export const useUpdateStatus = () =>
  useQuery({
    queryKey: ['updateStatus'],
    queryFn: () => api.updates.status(),
    // Faster while something is happening, so progress shows.
    refetchInterval: (q) => (q.state.data?.state === 'downloading' || q.state.data?.state === 'checking' ? 3000 : 60_000)
  })

function useInstall(status: UpdateStatus | undefined) {
  const install = useAction(() => api.updates.install())
  const confirm = () =>
    modals.openConfirmModal({
      title: `Install version ${status?.version}?`,
      children: (
        <Text size="sm">
          The app closes, updates and opens again by itself, which takes about a minute. A copy of the data is saved
          first. Finish anything you’re typing before you continue.
        </Text>
      ),
      labels: { confirm: 'Restart and update', cancel: 'Not now' },
      onConfirm: () => install.mutate([])
    })
  return { confirm, pending: install.isPending }
}

/** Top bar: shown only once an update has downloaded. */
export function UpdateButton() {
  const { data } = useUpdateStatus()
  const install = useInstall(data)
  if (data?.state !== 'ready') return null
  return (
    <Tooltip label={`Version ${data.version} is downloaded. It also installs by itself when the app is closed.`}>
      <Button variant="light" color="blue" leftSection={<IconDownload size={16} />} loading={install.pending} onClick={install.confirm}>
        Update ready – restart
      </Button>
    </Tooltip>
  )
}

function describe(s: UpdateStatus): string {
  switch (s.state) {
    case 'idle':
      return 'The app looks for updates a couple of minutes after it opens, then every 4 hours.'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return `Up to date${s.lastCheckedAt ? `, checked ${fromNow(s.lastCheckedAt)}` : ''}.`
    case 'downloading':
      return `Downloading version ${s.version}… ${s.percent ?? 0}%`
    case 'ready':
      return `Version ${s.version} is ready. It installs when the app is closed, or restart now to install it.`
    case 'error':
      return `Couldn’t check for updates: ${s.error}`
  }
}

/** Settings card: the current version, update status and a manual check. */
export function UpdatesCard() {
  const { data } = useUpdateStatus()
  const check = useAction(() => api.updates.check())
  const install = useInstall(data)
  if (!data) return null
  return (
    <Paper p="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconRefresh />
          <Title order={4}>App updates</Title>
        </Group>
        <Badge variant="light">Version {data.currentVersion}</Badge>
      </Group>
      {!data.enabled ? (
        <Text size="sm" c="dimmed">
          Updates are off in development builds.
        </Text>
      ) : (
        <>
          <Text size="sm" c={data.state === 'error' ? 'orange.8' : undefined} mb="md">
            {describe(data)}
          </Text>
          <Group>
            <Button
              variant="default"
              loading={check.isPending || data.state === 'checking'}
              disabled={data.state === 'downloading'}
              onClick={() => check.mutate([])}
            >
              Check now
            </Button>
            {data.state === 'ready' && (
              <Button leftSection={<IconDownload size={16} />} loading={install.pending} onClick={install.confirm}>
                Restart and update
              </Button>
            )}
          </Group>
        </>
      )}
    </Paper>
  )
}

import { Alert, Anchor, Button, Group, Paper, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { IconExternalLink, IconFileSpreadsheet, IconRefresh } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ownerEmailInput } from '@shared/schemas'
import { api, notifySuccess, useAction } from '../lib/api'
import { formatDateTime, fromNow } from '../lib/format'

/** The Google Sheet in Drive that keeps the owner up to date, with nobody at the desk doing anything. */
export function OwnerSummaryCard() {
  const { data } = useQuery({ queryKey: ['ownerSummary'], queryFn: () => api.summary.status(), refetchInterval: 60_000 })
  const [email, setEmail] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const toggle = useAction((on: boolean) => api.summary.setEnabled(on))
  const update = useAction(() => api.summary.updateNow(), { success: 'Daily summary updated in Google Drive' })
  const share = useAction((value: string) => api.summary.setOwnerEmail(value))
  if (!data) return null
  const typed = email ?? data.ownerEmail

  const submit = () => {
    const parsed = ownerEmailInput.safeParse(typed)
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? 'Check the email address')
      return
    }
    setEmailError(null)
    const value = parsed.data as string
    share.mutate([value], {
      onSuccess: () => {
        setEmail(null)
        notifySuccess(value ? 'Shared. The owner gets an email from Google with the link.' : 'Saved')
      }
    })
  }

  return (
    <Paper p="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconFileSpreadsheet />
          <Title order={4}>Owner’s daily summary</Title>
        </Group>
        {data.driveConnected && (
          <Switch
            label={data.enabled ? 'On' : 'Off'}
            checked={data.enabled}
            disabled={toggle.isPending}
            onChange={(e) => toggle.mutate([e.currentTarget.checked])}
          />
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        A Google Sheet in the gym’s Drive with each day’s takings (cash, card and bank transfer), new sign-ups,
        renewals and check-ins, for this month and the two before. The app rewrites it every hour while it’s open and
        when it closes, so the owner can check it on their phone.
      </Text>

      {!data.driveConnected ? (
        <Alert color="gray">Connect Google Drive above first.</Alert>
      ) : (
        data.enabled && (
          <Stack>
            <Group gap="xl" align="flex-end">
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Last updated
                </Text>
                <Text size="sm">
                  {data.lastUpdatedAt ? `${formatDateTime(data.lastUpdatedAt)} (${fromNow(data.lastUpdatedAt)})` : 'Not yet'}
                </Text>
              </Stack>
              {data.url && (
                <Anchor href={data.url} target="_blank" size="sm">
                  <Group gap={4}>
                    Open in Google Sheets <IconExternalLink size={14} />
                  </Group>
                </Anchor>
              )}
            </Group>
            {data.lastError && (
              <Alert color="orange" title="The last update failed">
                {data.lastError}
              </Alert>
            )}
            <Group align="flex-start">
              <TextInput
                label="Share it with the owner’s Google account"
                description="They get an email with the link, and can open it in the Google Sheets app."
                placeholder="owner@gmail.com"
                w={360}
                value={typed}
                error={emailError}
                onChange={(e) => {
                  setEmail(e.currentTarget.value)
                  setEmailError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <Button mt={46} variant="default" loading={share.isPending} disabled={typed.trim() === data.ownerEmail} onClick={submit}>
                {typed.trim() ? 'Share' : 'Save'}
              </Button>
            </Group>
            <Group>
              <Button
                leftSection={<IconRefresh size={16} />}
                loading={update.isPending || data.running}
                onClick={() => update.mutate([])}
              >
                Update now
              </Button>
            </Group>
          </Stack>
        )
      )}
    </Paper>
  )
}

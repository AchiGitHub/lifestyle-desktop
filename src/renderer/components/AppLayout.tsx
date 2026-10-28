import { AppShell, Badge, Box, Button, Group, Image, NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core'
import {
  IconCalendarDue,
  IconCash,
  IconCloudCheck,
  IconCloudOff,
  IconCloudUpload,
  IconDoorEnter,
  IconId,
  IconLayoutDashboard,
  IconListDetails,
  IconLogout,
  IconPlus,
  IconSettings,
  IconShoppingCart,
  IconUserOff,
  IconUsers
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/logo.jpeg'
import { api, useAction } from '../lib/api'
import { fromNow } from '../lib/format'
import { useBackupStatus } from '../lib/queries'
import { BackupBanner } from './BackupBanner'
import { showCheckInAlert } from './checkIns'
import { useMemberDrawer } from './MemberDrawer'
import { MemberSearch } from './MemberSearch'
import { UpdateButton } from './Updates'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/check-ins', label: 'Check-ins', icon: IconDoorEnter },
  { to: '/members', label: 'Members', icon: IconUsers },
  { to: '/registrations', label: 'Registrations', icon: IconId },
  { to: '/expiring', label: 'Renewals due', icon: IconCalendarDue },
  { to: '/expired', label: 'Not renewed', icon: IconUserOff },
  { to: '/payments', label: 'Payments', icon: IconCash },
  { to: '/store', label: 'Store', icon: IconShoppingCart },
  { to: '/plans', label: 'Plans', icon: IconListDetails }
]

function BackupIndicator() {
  const { data } = useBackupStatus()
  const backup = useAction(() => api.backup.backupNow(), { success: 'Backed up to Google Drive' })
  if (!data || !data.driveConfigured) return null

  if (!data.driveConnected) {
    return (
      <Button component={Link} to="/settings" variant="light" color="gray" leftSection={<IconCloudOff size={16} />}>
        Backup not set up
      </Button>
    )
  }
  const running = data.running || backup.isPending
  const label = data.lastBackupAt ? `Backed up ${fromNow(data.lastBackupAt)}` : 'Not backed up yet'
  return (
    <Tooltip label={data.lastError ? `Last attempt failed: ${data.lastError}` : 'Back up to Google Drive now'}>
      <Button
        variant="light"
        color={data.lastError ? 'orange' : 'teal'}
        loading={running}
        leftSection={data.lastError ? <IconCloudUpload size={16} /> : <IconCloudCheck size={16} />}
        onClick={() => backup.mutate([])}
      >
        {label}
      </Button>
    </Tooltip>
  )
}

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openMember } = useMemberDrawer()

  // Check-ins at the door tablet: refresh the lists, and alert staff when someone needs them.
  useEffect(
    () =>
      window.events.onCheckIn((result) => {
        void queryClient.invalidateQueries()
        showCheckInAlert(result, openMember)
      }),
    [queryClient, openMember]
  )

  const signOut = async () => {
    await api.auth.logout()
    queryClient.clear()
    await queryClient.invalidateQueries({ queryKey: ['auth'] })
  }

  return (
    <AppShell navbar={{ width: 232, breakpoint: 0 }} header={{ height: 64 }} padding="lg">
      <AppShell.Header px="lg">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <MemberSearch />
          <Group gap="sm" wrap="nowrap">
            <UpdateButton />
            <BackupIndicator />
            <Button leftSection={<IconPlus size={16} />} onClick={() => navigate('/registrations/new')}>
              New registration
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar bg="brand.9" p="sm" style={{ borderRight: 'none' }}>
        <AppShell.Section>
          <Box mb="md" p={4} className="nav-logo">
            <Image src={logo} radius="md" alt="Lifestyle Fitness Studio" />
          </Box>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={2}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                component={Link}
                to={item.to}
                label={item.label}
                className="nav-link"
                leftSection={<item.icon size={19} stroke={1.6} />}
                active={location.pathname.startsWith(item.to)}
                variant="subtle"
                color="gray.0"
              />
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section>
          <Stack gap={2}>
            <NavLink
              component={Link}
              to="/settings"
              label="Settings"
              className="nav-link"
              leftSection={<IconSettings size={19} stroke={1.6} />}
              active={location.pathname.startsWith('/settings')}
              variant="subtle"
              color="gray.0"
            />
            <NavLink
              component="button"
              label="Sign out"
              className="nav-link"
              leftSection={<IconLogout size={19} stroke={1.6} />}
              onClick={() => void signOut()}
            />
            <Text size="xs" c="brand.2" ta="center" mt="xs" className="nav-footer">
              Lifestyle Fitness Studio <Badge size="xs" variant="transparent" c="brand.3">v{APP_VERSION}</Badge>
            </Text>
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <BackupBanner />
        {children}
      </AppShell.Main>
    </AppShell>
  )
}

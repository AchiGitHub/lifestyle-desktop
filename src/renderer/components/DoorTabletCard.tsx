import {
  ActionIcon,
  Alert,
  Button,
  Code,
  Group,
  Image,
  Modal,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Table,
  Text,
  Title
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDeviceTablet, IconQrcode, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { toDataURL } from 'qrcode'
import { useEffect, useState } from 'react'
import type { DoorPairing } from '@shared/api'
import { api, useAction } from '../lib/api'
import { formatDateTime, fromNow } from '../lib/format'

const useDoorStatus = (fast = false) =>
  useQuery({ queryKey: ['doorTablet'], queryFn: () => api.doorTablet.status(), refetchInterval: fast ? 2000 : 15_000 })

/** The code and QR to scan on the tablet; closes itself once the tablet has paired. */
function PairingModal({ pairing, onClose }: { pairing: DoorPairing; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null)
  const { data } = useDoorStatus(true)
  const [startCount] = useState(() => data?.devices.length ?? 0)

  useEffect(() => {
    void toDataURL(pairing.url, { margin: 1, width: 260 }).then(setQr)
  }, [pairing.url])
  useEffect(() => {
    if (data && data.devices.length > startCount) {
      notifications.show({ color: 'teal', message: 'Tablet paired' })
      onClose()
    }
  }, [data, startCount, onClose])

  return (
    <Modal opened onClose={onClose} title="Pair a tablet" size="md">
      <Stack align="center" gap="sm">
        <Text size="sm" ta="center">
          On the tablet, scan this with the camera and open the link. Or open the address in the tablet’s browser and
          type the code.
        </Text>
        {qr && <Image src={qr} w={260} h={260} alt="QR code for pairing" />}
        <Code fz="sm">{pairing.url.split('#')[0]}</Code>
        <Text fz={40} fw={700} lts={8}>
          {pairing.code}
        </Text>
        <Text size="xs" c="dimmed">
          The code works once, until {dayjs(pairing.expiresAt).format('h:mm A')}.
        </Text>
      </Stack>
    </Modal>
  )
}

export function DoorTabletCard() {
  const { data } = useDoorStatus()
  const [pairing, setPairing] = useState<DoorPairing | null>(null)
  const [port, setPort] = useState<string | number>('')
  const toggle = useAction((on: boolean) => api.doorTablet.setEnabled(on))
  const savePort = useAction((n: number) => api.doorTablet.setPort(n), { success: 'Port changed' })
  const remove = useAction((id: string) => api.doorTablet.removeDevice(id), { success: 'Tablet removed' })
  const startPairing = useAction(() => api.doorTablet.startPairing())
  if (!data) return null
  const portChanged = port !== '' && Number(port) !== data.port

  return (
    <Paper p="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconDeviceTablet />
          <Title order={4}>Door check-in tablet</Title>
        </Group>
        <Switch
          label={data.enabled ? 'On' : 'Off'}
          checked={data.enabled}
          disabled={toggle.isPending}
          onChange={(e) => toggle.mutate([e.currentTarget.checked])}
        />
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Members check themselves in on a tablet at the door, over the gym’s Wi-Fi. The tablet opens a page served by
        this computer, so this computer must be on with the app open.
      </Text>

      {data.error && (
        <Alert color="red" mb="md">
          {data.error}
        </Alert>
      )}

      {data.enabled && data.running && (
        <Stack>
          <Group gap="xs">
            <Text size="sm">Tablet address:</Text>
            {data.addresses.length > 0 ? (
              data.addresses.map((a) => <Code key={a}>{a}</Code>)
            ) : (
              <Text size="sm" c="orange.8">
                This computer isn’t connected to a network.
              </Text>
            )}
          </Group>
          <Group align="flex-end">
            <Button
              leftSection={<IconQrcode size={16} />}
              loading={startPairing.isPending}
              onClick={() => startPairing.mutate([], { onSuccess: setPairing })}
            >
              Pair a tablet
            </Button>
            <NumberInput
              label="Port"
              w={110}
              min={1024}
              max={65535}
              allowDecimal={false}
              thousandSeparator=""
              defaultValue={data.port}
              onChange={setPort}
            />
            {portChanged && (
              <Button variant="default" loading={savePort.isPending} onClick={() => savePort.mutate([Number(port)])}>
                Save port
              </Button>
            )}
          </Group>

          {data.devices.length === 0 ? (
            <Text size="sm" c="dimmed">
              No tablets paired yet.
            </Text>
          ) : (
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tablet</Table.Th>
                  <Table.Th>Paired</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.devices.map((d) => (
                  <Table.Tr key={d.id}>
                    <Table.Td>{d.name}</Table.Td>
                    <Table.Td>{formatDateTime(d.pairedAt)}</Table.Td>
                    <Table.Td>{d.lastSeenAt ? fromNow(d.lastSeenAt) : '—'}</Table.Td>
                    <Table.Td ta="right">
                      <ActionIcon variant="subtle" color="red" aria-label="Remove tablet" onClick={() => remove.mutate([d.id])}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="xs" c="dimmed">
            If Windows asks whether Lifestyle may use the network, allow it on private networks. A removed tablet has
            to be paired again.
          </Text>
        </Stack>
      )}

      {pairing && <PairingModal pairing={pairing} onClose={() => setPairing(null)} />}
    </Paper>
  )
}

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
  TextInput,
  Title
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconQrcode, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { toDataURL } from 'qrcode'
import { useEffect, useState, type ReactNode } from 'react'
import type { Api, LanPairing } from '@shared/api'
import { api, useAction } from '../lib/api'
import { formatDateTime, fromNow } from '../lib/format'

type LanGroup = 'doorTablet' | 'staffDevices'

// Both groups work alike; instructor phones also take a name when pairing.
const lanApi = (group: LanGroup) => api[group] as Api['staffDevices']

const useLanStatus = (group: LanGroup, fast = false) =>
  useQuery({ queryKey: ['lan', group], queryFn: () => lanApi(group).status(), refetchInterval: fast ? 2000 : 15_000 })

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The code and QR to scan on the device; closes itself once it has paired. */
function PairingModal({
  group,
  noun,
  pairing,
  title,
  onClose
}: {
  group: LanGroup
  noun: string
  pairing: LanPairing
  title: string
  onClose: () => void
}) {
  const [qr, setQr] = useState<string | null>(null)
  const { data } = useLanStatus(group, true)
  const [startCount] = useState(() => data?.devices.length ?? 0)

  useEffect(() => {
    void toDataURL(pairing.url, { margin: 1, width: 260 }).then(setQr)
  }, [pairing.url])
  useEffect(() => {
    if (data && data.devices.length > startCount) {
      notifications.show({ color: 'teal', message: `${capitalize(noun)} paired` })
      onClose()
    }
  }, [data, startCount, noun, onClose])

  return (
    <Modal opened onClose={onClose} title={title} size="md">
      <Stack align="center" gap="sm">
        <Text size="sm" ta="center">
          On the {noun}, connected to the gym Wi-Fi, scan this with the camera and open the link. Or open the address in
          the {noun}’s browser and type the code.
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

/** Asks whose phone it is before showing the pairing code. */
function NameModal({ onClose, onName, busy }: { onClose: () => void; onName: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('')
  return (
    <Modal opened onClose={onClose} title="Pair a phone" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onName(name)
        }}
      >
        <Stack>
          <TextInput
            label="Instructor’s name"
            description="Sales and stock changes from this phone are recorded under this name."
            data-autofocus
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              Show the code
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

/** Settings for a server on the gym network: on/off, address, port, and the devices paired to it. */
export function LanDevicesCard({
  group,
  title,
  icon,
  description,
  noun,
  named
}: {
  group: LanGroup
  title: string
  icon: ReactNode
  description: ReactNode
  /** "tablet" or "phone". */
  noun: string
  /** Each device is paired under the instructor's name. */
  named?: boolean
}) {
  const { data } = useLanStatus(group)
  const [pairing, setPairing] = useState<{ pairing: LanPairing; title: string } | null>(null)
  const [asking, setAsking] = useState(false)
  const [port, setPort] = useState<string | number>('')
  const toggle = useAction((on: boolean) => lanApi(group).setEnabled(on))
  const savePort = useAction((n: number) => lanApi(group).setPort(n), { success: 'Port changed' })
  const remove = useAction((id: string) => lanApi(group).removeDevice(id), { success: `${capitalize(noun)} removed` })
  const startPairing = useAction((name: string) => lanApi(group).startPairing(name))
  if (!data) return null
  const portChanged = port !== '' && Number(port) !== data.port

  const pair = (name = '') =>
    startPairing.mutate([name], {
      onSuccess: (p) => {
        setAsking(false)
        setPairing({ pairing: p, title: named ? `Pair ${name.trim()}’s phone` : `Pair a ${noun}` })
      }
    })

  return (
    <Paper p="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          {icon}
          <Title order={4}>{title}</Title>
        </Group>
        <Switch
          label={data.enabled ? 'On' : 'Off'}
          checked={data.enabled}
          disabled={toggle.isPending}
          onChange={(e) => toggle.mutate([e.currentTarget.checked])}
        />
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        {description}
      </Text>

      {data.error && (
        <Alert color="red" mb="md">
          {data.error}
        </Alert>
      )}

      {data.enabled && data.running && (
        <Stack>
          <Group gap="xs">
            <Text size="sm">{capitalize(noun)} address:</Text>
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
              loading={startPairing.isPending && !asking}
              onClick={() => (named ? setAsking(true) : pair())}
            >
              Pair a {noun}
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
              No {noun}s paired yet.
            </Text>
          ) : (
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{named ? 'Instructor' : capitalize(noun)}</Table.Th>
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
                      <ActionIcon variant="subtle" color="red" aria-label={`Remove ${noun}`} onClick={() => remove.mutate([d.id])}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="xs" c="dimmed">
            If Windows asks whether Lifestyle may use the network, allow it on private networks. A removed {noun} has to be
            paired again.
          </Text>
        </Stack>
      )}

      {asking && <NameModal busy={startPairing.isPending} onClose={() => setAsking(false)} onName={pair} />}
      {pairing && (
        <PairingModal
          group={group}
          noun={noun}
          pairing={pairing.pairing}
          title={pairing.title}
          onClose={() => setPairing(null)}
        />
      )}
    </Paper>
  )
}

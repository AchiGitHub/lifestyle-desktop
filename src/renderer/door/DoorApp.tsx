import { Box, Button, Center, Group, Image, Loader, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconAlertTriangle, IconBackspace, IconCircleCheck, IconWifiOff } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import type { CheckInCandidate } from '@shared/api'
import { daysBetween, todayIso } from '@shared/dates'
import { longDate } from '@shared/format'
import logo from '../assets/logo.jpeg'
import { checkIn, DoorError, find, forgetToken, getToken, pair, ping, type DoorCheckIn } from './api'

type Screen =
  | { kind: 'number' }
  | { kind: 'pick'; people: CheckInCandidate[] }
  | { kind: 'notFound' }
  | { kind: 'result'; result: DoorCheckIn }

const MAX_DIGITS = 12

/** "077 123 4567" while typing. */
const spaced = (d: string): string => [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ')

function Keypad({ onKey, disabled }: { onKey: (key: string) => void; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']
  return (
    <SimpleGrid cols={3} spacing="sm">
      {keys.map((k) => (
        <Button
          key={k}
          className="door-key"
          variant={k === 'clear' || k === 'back' ? 'light' : 'default'}
          color={k === 'clear' || k === 'back' ? 'gray' : undefined}
          disabled={disabled}
          onClick={() => onKey(k)}
          aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}
        >
          {k === 'back' ? <IconBackspace size={30} /> : k === 'clear' ? <Text fz={20}>Clear</Text> : k}
        </Button>
      ))}
    </SimpleGrid>
  )
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <Text c="white" fz={28} fw={600}>
      {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
    </Text>
  )
}

function Result({ result: r, onDone }: { result: DoorCheckIn; onDone: () => void }) {
  const ok = r.status === 'OK'
  let title = `Hi ${r.firstName}`
  let detail = 'Please see the front desk.'
  if (ok && r.repeat) {
    title = `Welcome back, ${r.firstName}!`
    detail = 'You’re already checked in.'
  } else if (ok) {
    title = `Welcome, ${r.firstName}!`
    const left = r.endDate ? daysBetween(todayIso(), r.endDate) : null
    detail =
      left !== null && left <= 7
        ? `Your membership ${left === 0 ? 'ends today' : `ends in ${left} day${left === 1 ? '' : 's'}`}. Renew at the front desk.`
        : r.endDate
          ? `Active until ${longDate(r.endDate)}`
          : ''
  } else if (r.status === 'EXPIRED' && r.endDate) {
    detail = `Your membership ended on ${longDate(r.endDate)}. Please see the front desk.`
  }
  return (
    <Stack align="center" gap="lg" py="xl">
      <ThemeIcon size={120} radius={60} color={ok ? 'teal' : 'orange'} variant="light">
        {ok ? <IconCircleCheck size={84} /> : <IconAlertTriangle size={84} />}
      </ThemeIcon>
      <Title order={1} ta="center" fz={40}>
        {title}
      </Title>
      <Text fz={22} ta="center" c="dimmed">
        {detail}
      </Text>
      <Button size="xl" variant="light" onClick={onDone} mt="md">
        Done
      </Button>
    </Stack>
  )
}

function PairScreen({ onPaired, initialError }: { onPaired: () => void; initialError: string | null }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [busy, setBusy] = useState(false)
  const submit = async (value: string) => {
    setBusy(true)
    try {
      await pair(value)
      onPaired()
    } catch (e) {
      setError((e as Error).message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  const onKey = (k: string) => {
    setError(null)
    if (k === 'clear') return setCode('')
    if (k === 'back') return setCode((c) => c.slice(0, -1))
    const next = (code + k).slice(0, 6)
    setCode(next)
    if (next.length === 6) void submit(next)
  }
  return (
    <Stack gap="md">
      <Title order={2}>Pair this tablet</Title>
      <Text fz="lg" c="dimmed">
        At the front desk, open Settings → Door check-in tablet → Pair a tablet, and enter the 6-digit code shown there.
      </Text>
      <Paper p="md" bg="gray.0" ta="center">
        <Text fz={40} fw={700} lts={8} mih={60}>
          {busy ? <Loader /> : code.padEnd(6, '·')}
        </Text>
      </Paper>
      {error && (
        <Text c="red" fz="lg">
          {error}
        </Text>
      )}
      <Keypad onKey={onKey} disabled={busy} />
    </Stack>
  )
}

export function DoorApp() {
  const [paired, setPaired] = useState(Boolean(getToken()))
  const [pairError, setPairError] = useState<string | null>(null)
  const [gymName, setGymName] = useState('')
  const [offline, setOffline] = useState(false)
  const [screen, setScreen] = useState<Screen>({ kind: 'number' })
  const [digits, setDigits] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    setScreen({ kind: 'number' })
    setDigits('')
    setMessage(null)
  }, [])

  const fail = useCallback((e: unknown) => {
    const err = e instanceof DoorError ? e : new DoorError('message', String(e))
    if (err.kind === 'unpaired') {
      forgetToken()
      setPaired(false)
    } else if (err.kind === 'offline') {
      setOffline(true)
    } else {
      setMessage(err.message)
    }
  }, [])

  // Opened from the QR code at the desk: http://<pc>:8787/#pair=123456
  useEffect(() => {
    const code = location.hash.match(/pair=(\d{6})/)?.[1]
    if (!code) return
    history.replaceState(null, '', location.pathname)
    pair(code).then(
      () => setPaired(true),
      (e: Error) => {
        setPairError(e.message)
        setPaired(false)
      }
    )
  }, [])

  // Is the desk PC there? Checked every 10 seconds.
  useEffect(() => {
    if (!paired) return
    const tick = () =>
      ping().then((r) => {
        setGymName(r.gymName)
        setOffline(false)
      }, fail)
    tick()
    const t = setInterval(tick, 10_000)
    return () => clearInterval(t)
  }, [paired, fail])

  // Back to the start after a while without a touch.
  useEffect(() => {
    if (screen.kind === 'number' && !digits && !message) return
    const t = setTimeout(reset, screen.kind === 'result' || screen.kind === 'notFound' ? 6000 : 20_000)
    return () => clearTimeout(t)
  }, [screen, digits, message, reset])

  // Full screen on the first touch (browsers only allow it after one).
  useEffect(() => {
    const go = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined)
    }
    window.addEventListener('pointerdown', go)
    return () => window.removeEventListener('pointerdown', go)
  }, [])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await work()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const onKey = (k: string) => {
    setMessage(null)
    if (k === 'clear') return setDigits('')
    if (k === 'back') return setDigits((d) => d.slice(0, -1))
    setDigits((d) => (d.length < MAX_DIGITS ? d + k : d))
  }
  const lookUp = () =>
    run(async () => {
      const { people } = await find(digits)
      setScreen(people.length ? { kind: 'pick', people } : { kind: 'notFound' })
    })
  const choose = (id: string) =>
    run(async () => {
      setScreen({ kind: 'result', result: await checkIn(id) })
    })

  let body
  if (!paired) {
    body = <PairScreen onPaired={() => setPaired(true)} initialError={pairError} />
  } else if (offline) {
    body = (
      <Stack align="center" gap="md" py="xl">
        <ThemeIcon size={100} radius={50} color="orange" variant="light">
          <IconWifiOff size={64} />
        </ThemeIcon>
        <Title order={2} ta="center">
          Check-in isn’t available right now
        </Title>
        <Text fz="xl" c="dimmed" ta="center">
          Please see the front desk.
        </Text>
      </Stack>
    )
  } else if (screen.kind === 'result') {
    body = <Result result={screen.result} onDone={reset} />
  } else if (screen.kind === 'pick') {
    body = (
      <Stack gap="md">
        <Title order={2}>Tap your name</Title>
        {screen.people.map((p) => (
          <Button key={p.id} size="xl" h={80} fz={28} variant="default" loading={busy} onClick={() => choose(p.id)}>
            {p.name}
          </Button>
        ))}
        <Button size="lg" variant="subtle" color="gray" onClick={reset}>
          Not me – start again
        </Button>
      </Stack>
    )
  } else if (screen.kind === 'notFound') {
    body = (
      <Stack align="center" gap="md" py="xl">
        <Title order={2} ta="center">
          We couldn’t find {spaced(digits)}
        </Title>
        <Text fz="xl" c="dimmed" ta="center">
          Check the number, or please see the front desk.
        </Text>
        <Button size="xl" onClick={reset}>
          Try again
        </Button>
      </Stack>
    )
  } else {
    body = (
      <Stack gap="md">
        <Title order={2}>Check in</Title>
        <Text fz="lg" c="dimmed">
          Type your mobile number
        </Text>
        <Paper p="md" bg="gray.0" ta="center">
          <Text fz={40} fw={700} mih={60} lts={2}>
            {spaced(digits) || '07X XXX XXXX'}
          </Text>
        </Paper>
        {message && (
          <Text c="red" fz="lg">
            {message}
          </Text>
        )}
        <Keypad onKey={onKey} disabled={busy} />
        <Button size="xl" h={72} fz={26} disabled={digits.length < 9} loading={busy} onClick={lookUp}>
          Continue
        </Button>
      </Stack>
    )
  }

  return (
    <Center mih="100%" p="md">
      <Box w="100%" maw={560}>
        <Group justify="space-between" mb="md" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Image src={logo} h={56} w="auto" radius="sm" alt="" />
            <Text c="white" fz={22} fw={600}>
              {gymName}
            </Text>
          </Group>
          <Clock />
        </Group>
        <Paper p="xl" radius="lg" shadow="xl">
          {body}
        </Paper>
      </Box>
    </Center>
  )
}

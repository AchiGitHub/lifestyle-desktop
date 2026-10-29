import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Drawer,
  Group,
  Image,
  Loader,
  NumberInput,
  Paper,
  PinInput,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton
} from '@mantine/core'
import {
  IconArrowBackUp,
  IconMinus,
  IconPackage,
  IconPlus,
  IconReceipt,
  IconSearch,
  IconShoppingCart,
  IconUser,
  IconWifiOff,
  IconX
} from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { MemberChoice, StaffProduct, StaffSale } from '@shared/api'
import {
  LOW_STOCK,
  PRODUCT_TYPE_LABELS,
  SALE_METHODS,
  SALE_METHOD_LABELS,
  type SaleMethod,
  type StockChangeKind
} from '@shared/enums'
import logo from '../assets/logo.jpeg'
import { lkr } from '../lib/format'
import * as staff from './api'

type Tab = 'sell' | 'stock' | 'today'

/** A sale, with when Undo stops working by this phone's clock. */
type Sale = StaffSale & { undoUntil: number }
const withDeadline = (s: StaffSale): Sale => ({ ...s, undoUntil: Date.now() + s.undoSecondsLeft * 1000 })
const canUndo = (s: Sale): boolean => s.undoUntil > Date.now()

type Notice = { color: 'teal' | 'gray'; text: string; sale?: Sale }

const saleText = (s: StaffSale): string =>
  `${s.quantity} × ${s.productName}${s.memberName ? ` to ${s.memberName}` : ''} · ${lkr(s.amount)} ${SALE_METHOD_LABELS[s.paymentType].toLowerCase()}`

function StockBadge({ quantity }: { quantity: number }) {
  if (quantity === 0) {
    return (
      <Badge color="red" variant="light">
        Out of stock
      </Badge>
    )
  }
  if (quantity <= LOW_STOCK) {
    return (
      <Badge color="orange" variant="light">
        {quantity} left
      </Badge>
    )
  }
  return (
    <Text size="sm" c="dimmed">
      {quantity} in stock
    </Text>
  )
}

function ProductList({
  products,
  onPick,
  selling
}: {
  products: StaffProduct[]
  onPick: (p: StaffProduct) => void
  /** Out-of-stock products can't be picked to sell. */
  selling?: boolean
}) {
  const [query, setQuery] = useState('')
  const words = query.trim().toLowerCase()
  const shown = products.filter((p) => p.name.toLowerCase().includes(words))
  return (
    <Stack gap="sm">
      <TextInput
        size="md"
        placeholder="Search products"
        leftSection={<IconSearch size={18} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {shown.length === 0 && (
        <Text c="dimmed" ta="center" py="lg">
          {products.length ? 'No product matches that.' : 'No products yet. They’re added at the front desk.'}
        </Text>
      )}
      {shown.map((p) => {
        const off = selling && p.quantity === 0
        return (
          <UnstyledButton key={p.id} onClick={() => onPick(p)} disabled={off} aria-label={p.name}>
            <Paper p="md" withBorder style={{ opacity: off ? 0.5 : 1 }}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Box miw={0}>
                  <Text fw={600} truncate>
                    {p.name}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {PRODUCT_TYPE_LABELS[p.productType]} · {lkr(p.sellingPrice)}
                  </Text>
                </Box>
                <StockBadge quantity={p.quantity} />
              </Group>
            </Paper>
          </UnstyledButton>
        )
      })}
    </Stack>
  )
}

/** − [ 2 ] + with buttons big enough for a thumb. */
function Stepper({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max?: number }) {
  return (
    <Group gap="sm" justify="center" wrap="nowrap">
      <ActionIcon size={52} variant="default" aria-label="One fewer" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <IconMinus />
      </ActionIcon>
      <NumberInput
        aria-label="How many"
        size="lg"
        w={100}
        hideControls
        allowDecimal={false}
        allowNegative={false}
        min={min}
        max={max}
        value={value}
        onChange={(v) => onChange(typeof v === 'number' ? v : 0)}
        styles={{ input: { textAlign: 'center', fontWeight: 700 } }}
      />
      <ActionIcon
        size={52}
        variant="default"
        aria-label="One more"
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(value + 1)}
      >
        <IconPlus />
      </ActionIcon>
    </Group>
  )
}

function Sheet({ title, opened, onClose, children }: { title: string; opened: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      title={<Text fw={700} fz="lg">{title}</Text>}
      // As tall as what's in it, rising from the bottom of the screen.
      styles={{
        content: { height: 'auto', maxHeight: '90dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
        body: { paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }
      }}
    >
      {children}
    </Drawer>
  )
}

/** Choosing who's buying: today's check-ins first, or a search by name or phone number. */
function MemberPicker({ onPick, onError }: { onPick: (m: MemberChoice) => void; onError: (e: unknown) => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<MemberChoice[] | null>(null)
  const [today, setToday] = useState<MemberChoice[] | null>(null)
  const searching = query.trim() !== ''

  useEffect(() => {
    staff.membersCheckedInToday().then(setToday, onError)
  }, [onError])
  useEffect(() => {
    if (!searching) return setFound(null)
    const t = setTimeout(() => staff.findMembers(query.trim()).then(setFound, onError), 300)
    return () => clearTimeout(t)
  }, [query, searching, onError])

  const list = searching ? found : today
  return (
    <Stack gap="sm">
      <TextInput
        size="md"
        placeholder="Name or phone number"
        leftSection={<IconSearch size={18} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Text size="sm" c="dimmed" fw={600}>
        {searching ? 'Members found' : 'Checked in today'}
      </Text>
      {list === null ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : list.length === 0 ? (
        <Text size="sm" c="dimmed">
          {searching
            ? 'No member found. Type more of their name, or part of their phone number.'
            : 'Nobody has checked in today. Search by name or phone number.'}
        </Text>
      ) : (
        <ScrollArea.Autosize mah="45dvh">
          <Stack gap={6}>
            {list.map((m) => (
              <UnstyledButton key={m.id} onClick={() => onPick(m)} aria-label={m.name}>
                <Paper p="sm" withBorder>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Text fw={600} truncate>
                      {m.name}
                    </Text>
                    {m.phoneEnding && (
                      <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                        ··· {m.phoneEnding}
                      </Text>
                    )}
                  </Group>
                </Paper>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  )
}

function SellSheet({
  product,
  busy,
  error,
  offline,
  onClose,
  onSell,
  onError
}: {
  product: StaffProduct | null
  busy: boolean
  error: string | null
  offline: boolean
  onClose: () => void
  onSell: (quantity: number, paymentType: SaleMethod, memberId: string | null) => void
  onError: (e: unknown) => void
}) {
  const [quantity, setQuantity] = useState(1)
  const [paymentType, setPaymentType] = useState<SaleMethod>('CASH')
  const [member, setMember] = useState<MemberChoice | null>(null)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    setQuantity(1)
    setPaymentType('CASH')
    setMember(null)
    setPicking(false)
  }, [product?.id])

  if (product && picking) {
    return (
      <Sheet title="Who’s buying?" opened onClose={onClose}>
        <Stack>
          <MemberPicker
            onError={onError}
            onPick={(m) => {
              setMember(m)
              setPicking(false)
            }}
          />
          <Button size="md" variant="default" fullWidth onClick={() => setPicking(false)}>
            Back
          </Button>
        </Stack>
      </Sheet>
    )
  }

  const credit = paymentType === 'CREDIT'
  const needsMember = credit && !member
  return (
    <Sheet title={product?.name ?? ''} opened={product !== null} onClose={onClose}>
      {product && (
        <Stack>
          <Text c="dimmed">
            {lkr(product.sellingPrice)} each · {product.quantity} in stock
          </Text>
          <Stepper value={quantity} onChange={setQuantity} min={1} max={product.quantity} />
          <Group gap="xs" wrap="nowrap">
            <Button
              size="md"
              variant="default"
              flex={1}
              miw={0}
              justify="flex-start"
              leftSection={<IconUser size={18} />}
              c={member ? undefined : credit ? 'orange.8' : 'dimmed'}
              onClick={() => setPicking(true)}
            >
              {member ? member.name : credit ? 'Who’s buying?' : 'Who’s buying? (optional)'}
            </Button>
            {member && (
              <ActionIcon size={42} variant="default" aria-label="Not a member" onClick={() => setMember(null)}>
                <IconX size={18} />
              </ActionIcon>
            )}
          </Group>
          {/* Two rows: four choices don't fit across a phone. */}
          <SimpleGrid cols={2} spacing="xs">
            {SALE_METHODS.map((t) => (
              <Button
                key={t}
                size="md"
                variant={paymentType === t ? 'light' : 'default'}
                aria-pressed={paymentType === t}
                onClick={() => setPaymentType(t)}
              >
                {SALE_METHOD_LABELS[t]}
              </Button>
            ))}
          </SimpleGrid>
          {needsMember && (
            <Text size="sm" c="orange.8">
              Choose who’s buying: only members can pay later.
            </Text>
          )}
          {error && <Text c="red">{error}</Text>}
          <Button
            size="lg"
            fullWidth
            loading={busy}
            disabled={offline || needsMember || quantity < 1 || quantity > product.quantity}
            onClick={() => onSell(quantity, paymentType, member?.id ?? null)}
          >
            {credit ? 'Record on credit' : 'Record sale'} · {lkr(product.sellingPrice * Math.max(quantity, 0))}
          </Button>
        </Stack>
      )}
    </Sheet>
  )
}

function StockSheet({
  product,
  busy,
  error,
  offline,
  onClose,
  onSave
}: {
  product: StaffProduct | null
  busy: boolean
  error: string | null
  offline: boolean
  onClose: () => void
  onSave: (kind: StockChangeKind, quantity: number) => void
}) {
  const [kind, setKind] = useState<StockChangeKind>('RECEIVED')
  const [quantity, setQuantity] = useState(1)
  useEffect(() => {
    setKind('RECEIVED')
    setQuantity(1)
  }, [product?.id])

  let preview = ''
  if (product) {
    const after = kind === 'RECEIVED' ? product.quantity + quantity : quantity
    const diff = after - product.quantity
    preview =
      kind === 'RECEIVED'
        ? `${product.quantity} → ${after} in stock`
        : diff === 0
          ? `Same as recorded: ${after}`
          : `Was ${product.quantity}, now ${after} (${diff > 0 ? '+' : '−'}${Math.abs(diff)})`
  }

  return (
    <Sheet title={product?.name ?? ''} opened={product !== null} onClose={onClose}>
      {product && (
        <Stack>
          <SegmentedControl
            fullWidth
            size="md"
            value={kind}
            onChange={(v) => {
              setKind(v as StockChangeKind)
              setQuantity(v === 'COUNT' ? product.quantity : 1)
            }}
            data={[
              { value: 'RECEIVED', label: 'Stock arrived' },
              { value: 'COUNT', label: 'Counted it' }
            ]}
          />
          <Text ta="center">{kind === 'RECEIVED' ? 'How many arrived?' : 'How many are on the shelf?'}</Text>
          <Stepper value={quantity} onChange={setQuantity} min={kind === 'RECEIVED' ? 1 : 0} />
          <Paper p="sm" bg="gray.0">
            <Text ta="center" fw={600}>
              {preview}
            </Text>
          </Paper>
          {error && <Text c="red">{error}</Text>}
          <Button
            size="lg"
            fullWidth
            loading={busy}
            disabled={offline || quantity < (kind === 'RECEIVED' ? 1 : 0)}
            onClick={() => onSave(kind, quantity)}
          >
            {kind === 'RECEIVED' ? `Add ${quantity} to stock` : 'Save count'}
          </Button>
        </Stack>
      )}
    </Sheet>
  )
}

function UndoSheet({
  sale,
  busy,
  error,
  onClose,
  onUndo
}: {
  sale: Sale | null
  busy: boolean
  error: string | null
  onClose: () => void
  onUndo: (sale: Sale) => void
}) {
  return (
    <Sheet title="Undo this sale?" opened={sale !== null} onClose={onClose}>
      {sale && (
        <Stack>
          <Text>
            {saleText(sale)}. The items go back into stock. Only do this if the sale didn’t happen.
          </Text>
          {error && <Text c="red">{error}</Text>}
          <Button size="lg" color="red" fullWidth loading={busy} onClick={() => onUndo(sale)}>
            Undo sale
          </Button>
          <Button size="lg" variant="default" fullWidth onClick={onClose}>
            Keep it
          </Button>
        </Stack>
      )}
    </Sheet>
  )
}

function Today({ sales, onUndo }: { sales: Sale[] | null; onUndo: (s: Sale) => void }) {
  if (!sales) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }
  const byType = Object.fromEntries(SALE_METHODS.map((t) => [t, 0])) as Record<SaleMethod, number>
  for (const s of sales) byType[s.paymentType] += s.amount
  const total = sales.reduce((sum, s) => sum + s.amount, 0)
  return (
    <Stack gap="sm">
      <Paper p="md" withBorder>
        <Group justify="space-between">
          <Text fw={600}>Sold on this phone today</Text>
          <Text fw={700}>{lkr(total)}</Text>
        </Group>
        {SALE_METHODS.filter((t) => byType[t] > 0).map((t) => (
          <Group key={t} justify="space-between" mt={4}>
            <Text size="sm" c="dimmed">
              {t === 'CASH' ? 'Cash to hand in' : t === 'CREDIT' ? 'On credit (to pay later)' : SALE_METHOD_LABELS[t]}
            </Text>
            <Text size="sm">{lkr(byType[t])}</Text>
          </Group>
        ))}
      </Paper>
      {sales.length === 0 && (
        <Text c="dimmed" ta="center" py="lg">
          No sales yet today.
        </Text>
      )}
      {sales.map((s) => (
        <Paper key={s.id} p="md" withBorder>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Box miw={0}>
              <Text fw={600} truncate>
                {s.productName} × {s.quantity}
              </Text>
              <Text size="sm" c="dimmed">
                {dayjs(s.paidAt).format('h:mm A')} · {SALE_METHOD_LABELS[s.paymentType]}
                {s.memberName && ` · ${s.memberName}`}
              </Text>
            </Box>
            <Group gap="xs" wrap="nowrap">
              <Text fw={600}>{lkr(s.amount)}</Text>
              {canUndo(s) && (
                <Button size="compact-sm" variant="light" color="red" onClick={() => onUndo(s)}>
                  Undo
                </Button>
              )}
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  )
}

function PairScreen({ initialError, onPaired }: { initialError: string | null; onPaired: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [busy, setBusy] = useState(false)
  const submit = async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      await staff.pair(value)
      onPaired()
    } catch (e) {
      setError((e as Error).message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack>
      <Title order={2}>Pair this phone</Title>
      <Text c="dimmed">
        At the front desk, open Settings → Instructor phones → Pair a phone. Scan the code shown there with this phone’s
        camera, or type its 6 digits here.
      </Text>
      <Center>
        <PinInput length={6} type="number" oneTimeCode size="md" value={code} onChange={setCode} onComplete={submit} disabled={busy} />
      </Center>
      {busy && (
        <Center>
          <Loader size="sm" />
        </Center>
      )}
      {error && <Text c="red">{error}</Text>}
    </Stack>
  )
}

const TABS: { value: Tab; label: string; icon: typeof IconShoppingCart }[] = [
  { value: 'sell', label: 'Sell', icon: IconShoppingCart },
  { value: 'stock', label: 'Stock', icon: IconPackage },
  { value: 'today', label: 'Today', icon: IconReceipt }
]

export function StaffApp() {
  const [paired, setPaired] = useState(Boolean(staff.getToken()))
  const [pairError, setPairError] = useState<string | null>(null)
  const [info, setInfo] = useState<{ gymName: string; deviceName: string | null }>({ gymName: '', deviceName: null })
  const [offline, setOffline] = useState(false)
  const [tab, setTab] = useState<Tab>('sell')
  const [products, setProducts] = useState<StaffProduct[] | null>(null)
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [selling, setSelling] = useState<StaffProduct | null>(null)
  const [stocking, setStocking] = useState<StaffProduct | null>(null)
  const [undoing, setUndoing] = useState<Sale | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)

  const fail = useCallback((e: unknown) => {
    const err = e instanceof staff.LanError ? e : new staff.LanError('message', String(e))
    if (err.kind === 'unpaired') {
      staff.forgetToken()
      setPairError('This phone was removed at the front desk. Pair it again.')
      setPaired(false)
    } else if (err.kind === 'offline') {
      setOffline(true)
    } else {
      setError(err.message)
    }
  }, [])

  const refresh = useCallback(async () => {
    const [about, list] = await Promise.all([staff.ping(), staff.listProducts()])
    setInfo(about)
    setProducts(list)
    setOffline(false)
  }, [])

  const loadSales = useCallback(async () => setSales((await staff.todaysSales()).map(withDeadline)), [])

  // Opened from the QR code at the desk: http://<pc>:8788/#pair=123456
  useEffect(() => {
    const code = location.hash.match(/pair=(\d{6})/)?.[1]
    if (!code) return
    history.replaceState(null, '', location.pathname)
    staff.pair(code).then(
      () => setPaired(true),
      (e: Error) => {
        setPairError(e.message)
        setPaired(false)
      }
    )
  }, [])

  // Prices and stock from the desk PC, every 10 seconds while the page is in view.
  useEffect(() => {
    if (!paired) return
    const tick = () => {
      if (document.visibilityState === 'visible') refresh().catch(fail)
    }
    tick()
    const t = setInterval(tick, 10_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [paired, refresh, fail])

  useEffect(() => {
    if (paired && tab === 'today') loadSales().catch(fail)
  }, [paired, tab, loadSales, fail])

  // Undo buttons go once their time is up.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.sale ? 20_000 : 6000)
    return () => clearTimeout(t)
  }, [notice])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await refresh()
      if (tab === 'today') await loadSales()
    } catch (e) {
      fail(e)
      // "Only 2 left": show what the desk PC has now.
      refresh().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const open = (show: () => void) => {
    setError(null)
    show()
  }

  const closeSheets = () => {
    setSelling(null)
    setStocking(null)
    setUndoing(null)
    setError(null)
  }

  const sell = (quantity: number, paymentType: SaleMethod, memberId: string | null) =>
    run(async () => {
      const sale = withDeadline(await staff.sell({ productId: selling!.id, quantity, paymentType, memberId }))
      closeSheets()
      setNotice({ color: 'teal', text: `Sold ${saleText(sale)}`, sale })
    })

  const saveStock = (kind: StockChangeKind, quantity: number) =>
    run(async () => {
      const r = await staff.changeStock(kind === 'RECEIVED' ? 'received' : 'count', stocking!.id, quantity)
      closeSheets()
      setNotice({ color: 'teal', text: `${r.productName}: ${r.quantityAfter} in stock` })
    })

  const undo = (sale: Sale) =>
    run(async () => {
      await staff.undo(sale.id)
      closeSheets()
      setNotice({ color: 'gray', text: `Sale undone. ${sale.quantity} × ${sale.productName} went back into stock.` })
    })

  const sheetOpen = selling !== null || stocking !== null || undoing !== null

  let body: ReactNode
  if (!paired) {
    body = <PairScreen initialError={pairError} onPaired={() => setPaired(true)} />
  } else if (!products) {
    body = offline ? null : (
      <Center py="xl">
        <Loader />
      </Center>
    )
  } else if (tab === 'sell') {
    body = <ProductList products={products} onPick={(p) => open(() => setSelling(p))} selling />
  } else if (tab === 'stock') {
    body = <ProductList products={products} onPick={(p) => open(() => setStocking(p))} />
  } else {
    body = <Today sales={sales} onUndo={(s) => open(() => setUndoing(s))} />
  }

  return (
    <>
      <Group className="staff-header" justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <Image src={logo} h={36} w="auto" radius="sm" alt="" />
          <Text c="white" fw={600} truncate>
            {info.gymName || 'Store'}
          </Text>
        </Group>
        {paired && info.deviceName && (
          <Text c="brand.1" size="sm" truncate>
            {info.deviceName}
          </Text>
        )}
      </Group>

      <Box className="staff-main">
        {paired && offline && (
          <Alert color="orange" icon={<IconWifiOff />} mb="md" title="Can’t reach the front desk computer">
            Check this phone is on the gym Wi-Fi and the app is open at the desk. Trying again every few seconds.
          </Alert>
        )}
        {error && !sheetOpen && (
          <Alert color="red" mb="md" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert color={notice.color} mb="md" withCloseButton onClose={() => setNotice(null)}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm">{notice.text}</Text>
              {notice.sale && canUndo(notice.sale) && (
                <Button
                  size="compact-sm"
                  variant="white"
                  color="red"
                  leftSection={<IconArrowBackUp size={14} />}
                  onClick={() => open(() => setUndoing(notice.sale!))}
                >
                  Undo
                </Button>
              )}
            </Group>
          </Alert>
        )}
        {body}
      </Box>

      {paired && (
        <nav className="staff-tabs">
          {TABS.map((t) => (
            <UnstyledButton
              key={t.value}
              className="staff-tab"
              data-active={tab === t.value || undefined}
              onClick={() => setTab(t.value)}
            >
              <t.icon size={24} stroke={1.8} />
              {t.label}
            </UnstyledButton>
          ))}
        </nav>
      )}

      <SellSheet
        product={selling}
        busy={busy}
        error={error}
        offline={offline}
        onClose={closeSheets}
        onSell={sell}
        onError={fail}
      />
      <StockSheet product={stocking} busy={busy} error={error} offline={offline} onClose={closeSheets} onSave={saveStock} />
      <UndoSheet sale={undoing} busy={busy} error={error} onClose={closeSheets} onUndo={undo} />
    </>
  )
}

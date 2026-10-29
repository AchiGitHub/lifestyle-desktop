import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput
} from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { IconEdit, IconPlus, IconShoppingCartPlus, IconTrash } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Product, StockChange } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import {
  LOW_STOCK,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  STOCK_CHANGE_KIND_LABELS,
  STORE_CATEGORIES,
  type StockChangeKind
} from '@shared/enums'
import { productEditInput, productInput, sellInput, type ProductInput, type SellInput } from '@shared/schemas'
import { AppTable } from '../components/AppTable'
import { useMemberOptions } from '../components/MemberSearch'
import { PageHeader } from '../components/PageHeader'
import { useReceipt } from '../components/ReceiptDialog'
import { api, useAction } from '../lib/api'
import { formatDateTime, lkr } from '../lib/format'
import { useProducts } from '../lib/queries'
import { PaymentsTable } from './Payments'

function StockBadge({ quantity }: { quantity: number }) {
  if (quantity === 0) return <Badge color="red">Out of stock</Badge>
  if (quantity <= LOW_STOCK) return <Badge color="orange">{quantity} left</Badge>
  return <Text size="sm">{quantity}</Text>
}

function SellForm({ products, productId, onClose }: { products: Product[]; productId?: string; onClose: () => void }) {
  const form = useForm<SellInput>({
    initialValues: { productId: productId ?? '', quantity: 1, paymentType: 'CASH', memberId: null },
    validate: schemaResolver(sellInput, { sync: true })
  })
  const members = useMemberOptions()
  const sell = useAction((v: SellInput) => api.products.sell(v), { success: 'Sale recorded' })
  const { showReceipt } = useReceipt()
  const product = products.find((p) => p.id === form.values.productId)
  const qty = Number(form.values.quantity) || 0
  const done = (paymentId: string) => {
    onClose()
    showReceipt(paymentId, true)
  }

  return (
    <form onSubmit={form.onSubmit((v) => sell.mutate([v], { onSuccess: done }))}>
      <Stack>
        <Select
          label="Product"
          searchable
          data={products.map((p) => ({
            value: p.id,
            label: `${p.name} · ${lkr(p.sellingPrice)} · ${p.quantity} in stock`,
            disabled: p.quantity === 0
          }))}
          {...form.getInputProps('productId')}
        />
        <NumberInput label="Quantity" min={1} max={product?.quantity} allowDecimal={false} {...form.getInputProps('quantity')} />
        <Select
          label="Bought by"
          placeholder="A walk-in, or search a member by name or phone"
          data={members.options}
          filter={members.filter}
          limit={12}
          searchable
          clearable
          nothingFoundMessage="No member found"
          {...form.getInputProps('memberId')}
        />
        <SegmentedControl
          data={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))}
          {...form.getInputProps('paymentType')}
        />
        {product && (
          <Paper p="sm" bg="gray.0">
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {qty} × {lkr(product.sellingPrice)}
                {qty > product.quantity
                  ? ` — only ${product.quantity} in stock`
                  : ` · ${product.quantity - qty} left after this sale`}
              </Text>
              <Text fw={700} fz="lg">
                {lkr(product.sellingPrice * qty)}
              </Text>
            </Group>
          </Paper>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={sell.isPending} disabled={!product || qty > product.quantity}>
            Record sale
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

function ProductForm({ product, onClose }: { product?: Product; onClose: () => void }) {
  const form = useForm<ProductInput>({
    initialValues: product
      ? {
          name: product.name,
          productType: product.productType,
          quantity: product.quantity,
          price: product.price,
          sellingPrice: product.sellingPrice
        }
      : ({ name: '', productType: 'BEVERAGE', quantity: '', price: '', sellingPrice: '' } as unknown as ProductInput),
    // Editing leaves stock alone: an instructor may sell while the form is open.
    validate: schemaResolver(product ? productEditInput : productInput, { sync: true })
  })
  const save = useAction(
    (v: ProductInput) => (product ? api.products.update(product.id, v) : api.products.create(v)),
    { success: product ? 'Product updated' : 'Product added' }
  )
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <TextInput label="Name" withAsterisk data-autofocus {...form.getInputProps('name')} />
        <SegmentedControl
          data={PRODUCT_TYPES.map((t) => ({ value: t, label: PRODUCT_TYPE_LABELS[t] }))}
          {...form.getInputProps('productType')}
        />
        {product ? (
          <Text size="sm" c="dimmed">
            {product.quantity} in stock. To change it, use <b>Stock</b> on the product’s row.
          </Text>
        ) : (
          <NumberInput label="In stock" min={0} allowDecimal={false} withAsterisk {...form.getInputProps('quantity')} />
        )}
        <Group grow>
          <NumberInput label="Cost price" prefix="Rs. " min={0} withAsterisk {...form.getInputProps('price')} />
          <NumberInput label="Selling price" prefix="Rs. " min={0} withAsterisk {...form.getInputProps('sellingPrice')} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {product ? 'Save changes' : 'Add product'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

/** A delivery adds to the stock; a count sets it. Both are kept under Stock changes. */
function StockForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const [kind, setKind] = useState<StockChangeKind>('RECEIVED')
  const [quantity, setQuantity] = useState<string | number>('')
  const n = typeof quantity === 'number' ? quantity : NaN
  const after = kind === 'RECEIVED' ? product.quantity + n : n
  const save = useAction(
    () =>
      kind === 'RECEIVED'
        ? api.products.receiveStock({ productId: product.id, quantity: n })
        : api.products.countStock({ productId: product.id, quantity: n }),
    { success: 'Stock updated' }
  )
  const valid = Number.isInteger(n) && n >= (kind === 'RECEIVED' ? 1 : 0)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) save.mutate([], { onSuccess: onClose })
      }}
    >
      <Stack>
        <Text size="sm">{product.quantity} in stock now.</Text>
        <SegmentedControl
          value={kind}
          onChange={(v) => setKind(v as StockChangeKind)}
          data={[
            { value: 'RECEIVED', label: 'Stock arrived' },
            { value: 'COUNT', label: 'Counted the shelf' }
          ]}
        />
        <NumberInput
          label={kind === 'RECEIVED' ? 'How many arrived?' : 'How many are there?'}
          min={0}
          allowDecimal={false}
          allowNegative={false}
          data-autofocus
          value={quantity}
          onChange={setQuantity}
        />
        {valid && (
          <Text size="sm" c="dimmed">
            {kind === 'RECEIVED'
              ? `${product.quantity} → ${after} in stock`
              : after === product.quantity
                ? 'Same as recorded.'
                : `Was ${product.quantity}, now ${after} (${after > product.quantity ? '+' : '−'}${Math.abs(after - product.quantity)})`}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!valid}>
            {kind === 'RECEIVED' ? 'Add to stock' : 'Save count'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

function StockChanges() {
  const [month, setMonth] = useState(todayIso())
  const range = monthRange(month)
  const { data = [], isPending } = useQuery({
    queryKey: ['stockChanges', range.from, range.to],
    queryFn: () => api.products.stockChanges(range)
  })
  return (
    <Stack>
      <MonthPickerInput value={month} onChange={(v) => v && setMonth(v)} valueFormat="MMMM YYYY" w={200} />
      <AppTable<StockChange>
        records={data}
        fetching={isPending}
        sort={{ columnAccessor: 'changedAt', direction: 'desc' }}
        emptyText="No deliveries or counts this month"
        columns={[
          { accessor: 'changedAt', title: 'Date', sortable: true, render: (c) => formatDateTime(c.changedAt) },
          { accessor: 'productName', title: 'Product', sortable: true },
          { accessor: 'kind', title: 'What', render: (c) => STOCK_CHANGE_KIND_LABELS[c.kind] },
          {
            accessor: 'change',
            title: 'Change',
            textAlign: 'right',
            render: (c) =>
              c.kind === 'COUNT' && c.change < 0 ? (
                <Badge color="orange" variant="light">
                  {-c.change} short
                </Badge>
              ) : (
                `${c.change > 0 ? '+' : ''}${c.change}`
              )
          },
          { accessor: 'quantityAfter', title: 'In stock after', textAlign: 'right' },
          {
            accessor: 'recordedBy',
            title: 'By',
            render: (c) =>
              c.recordedBy ?? (
                <Text size="sm" c="dimmed">
                  Front desk
                </Text>
              )
          }
        ]}
      />
    </Stack>
  )
}

function Sales() {
  const [month, setMonth] = useState(todayIso())
  const range = monthRange(month)
  const { data = [], isPending } = useQuery({
    queryKey: ['payments', range.from, range.to, STORE_CATEGORIES, null],
    queryFn: () => api.payments.list({ ...range, categories: STORE_CATEGORIES })
  })
  const total = data.reduce((s, p) => s + p.amount, 0)
  return (
    <Stack>
      <Group justify="space-between">
        <MonthPickerInput value={month} onChange={(v) => v && setMonth(v)} valueFormat="MMMM YYYY" w={200} />
        <Text fw={600}>
          {data.length} sales · {lkr(total)}
        </Text>
      </Group>
      <PaymentsTable records={data} fetching={isPending} showRecordedBy />
    </Stack>
  )
}

export function Store() {
  const { data: products = [], isPending } = useProducts()
  const [selling, setSelling] = useState<{ productId?: string } | null>(null)
  const [editing, setEditing] = useState<{ product?: Product } | null>(null)
  const [stocking, setStocking] = useState<Product | null>(null)
  const remove = useAction((ids: string[]) => api.products.delete(ids), { success: 'Product deleted' })

  return (
    <>
      <PageHeader
        title="Store"
        description="Drinks and supplements sold at the front desk or on instructors’ phones"
        actions={
          <>
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditing({})}>
              Add product
            </Button>
            <Button leftSection={<IconShoppingCartPlus size={16} />} onClick={() => setSelling({})}>
              Sell
            </Button>
          </>
        }
      />
      <Tabs defaultValue="products" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="products">Products</Tabs.Tab>
          <Tabs.Tab value="sales">Sales</Tabs.Tab>
          <Tabs.Tab value="stock">Stock changes</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="products">
          <AppTable<Product>
            records={products}
            fetching={isPending}
            sort={{ columnAccessor: 'name', direction: 'asc' }}
            emptyText="No products yet"
            columns={[
              { accessor: 'name', title: 'Name', sortable: true },
              { accessor: 'productType', title: 'Type', render: (p) => PRODUCT_TYPE_LABELS[p.productType] },
              { accessor: 'quantity', title: 'In stock', sortable: true, render: (p) => <StockBadge quantity={p.quantity} /> },
              { accessor: 'price', title: 'Cost', textAlign: 'right', render: (p) => lkr(p.price) },
              { accessor: 'sellingPrice', title: 'Price', textAlign: 'right', render: (p) => lkr(p.sellingPrice) },
              { accessor: 'sold', title: 'Sold', sortable: true, textAlign: 'right' },
              {
                accessor: 'actions',
                title: '',
                textAlign: 'right',
                render: (p) => (
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="light"
                      disabled={p.quantity === 0}
                      onClick={() => setSelling({ productId: p.id })}
                    >
                      Sell
                    </Button>
                    <Button size="xs" variant="default" onClick={() => setStocking(p)}>
                      Stock
                    </Button>
                    <ActionIcon variant="subtle" color="gray" aria-label="Edit" onClick={() => setEditing({ product: p })}>
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Delete"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: `Delete ${p.name}?`,
                          children: <Text size="sm">Past sales stay in the payments list.</Text>,
                          labels: { confirm: 'Delete', cancel: 'Cancel' },
                          confirmProps: { color: 'red' },
                          onConfirm: () => remove.mutate([[p.id]])
                        })
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                )
              }
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="sales">
          <Sales />
        </Tabs.Panel>
        <Tabs.Panel value="stock">
          <StockChanges />
        </Tabs.Panel>
      </Tabs>

      <Modal opened={stocking !== null} onClose={() => setStocking(null)} title={stocking ? `Stock: ${stocking.name}` : ''}>
        {stocking && <StockForm product={stocking} onClose={() => setStocking(null)} />}
      </Modal>

      <Modal opened={selling !== null} onClose={() => setSelling(null)} title="Sell">
        {selling && <SellForm products={products} productId={selling.productId} onClose={() => setSelling(null)} />}
      </Modal>
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.product ? 'Edit product' : 'Add product'}
      >
        {editing && <ProductForm product={editing.product} onClose={() => setEditing(null)} />}
      </Modal>
    </>
  )
}

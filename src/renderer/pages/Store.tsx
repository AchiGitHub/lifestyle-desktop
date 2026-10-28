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
import type { Product } from '@shared/api'
import { monthRange, todayIso } from '@shared/dates'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, PRODUCT_TYPES, PRODUCT_TYPE_LABELS, STORE_CATEGORIES } from '@shared/enums'
import { productInput, sellInput, type ProductInput, type SellInput } from '@shared/schemas'
import { AppTable } from '../components/AppTable'
import { PageHeader } from '../components/PageHeader'
import { useReceipt } from '../components/ReceiptDialog'
import { api, useAction } from '../lib/api'
import { lkr } from '../lib/format'
import { useProducts } from '../lib/queries'
import { PaymentsTable } from './Payments'

const LOW_STOCK = 5

function StockBadge({ quantity }: { quantity: number }) {
  if (quantity === 0) return <Badge color="red">Out of stock</Badge>
  if (quantity <= LOW_STOCK) return <Badge color="orange">{quantity} left</Badge>
  return <Text size="sm">{quantity}</Text>
}

function SellForm({ products, productId, onClose }: { products: Product[]; productId?: string; onClose: () => void }) {
  const form = useForm<SellInput>({
    initialValues: { productId: productId ?? '', quantity: 1, paymentType: 'CASH' },
    validate: schemaResolver(sellInput, { sync: true })
  })
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
    validate: schemaResolver(productInput, { sync: true })
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
        <NumberInput
          label="In stock"
          description={product ? 'Change this when new stock arrives or after a count.' : undefined}
          min={0}
          allowDecimal={false}
          withAsterisk
          {...form.getInputProps('quantity')}
        />
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
      <PaymentsTable records={data} fetching={isPending} />
    </Stack>
  )
}

export function Store() {
  const { data: products = [], isPending } = useProducts()
  const [selling, setSelling] = useState<{ productId?: string } | null>(null)
  const [editing, setEditing] = useState<{ product?: Product } | null>(null)
  const remove = useAction((ids: string[]) => api.products.delete(ids), { success: 'Product deleted' })

  return (
    <>
      <PageHeader
        title="Store"
        description="Drinks and supplements sold at the front desk"
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
      </Tabs>

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

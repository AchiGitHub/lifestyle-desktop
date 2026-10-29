import { randomUUID } from 'node:crypto'
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { Product, StaffProduct, StaffSale, StockChange, StockResult } from '../../shared/api'
import { nowLocalIso, todayIso } from '../../shared/dates'
import type { StockChangeKind } from '../../shared/enums'
import {
  dateRangeInput,
  productEditInput,
  productInput,
  sellInput,
  stockCountInput,
  stockReceivedInput,
  type DateRangeInput,
  type ProductEditInput,
  type ProductInput,
  type SellInput,
  type StockInput
} from '../../shared/schemas'
import type { Db } from '../db/client'
import { creditSales, members, payments, products, stockChanges } from '../db/schema'
import { deleteCreditSale } from './credit'
import { AppError, nowUtc } from './errors'
import { deletePayment, nextReceiptNo } from './payments'

/** The instructor's phone a sale or stock change was made on. The front desk passes none. */
export interface Recorder {
  deviceId: string
  name: string
}

/** How long an instructor's phone can take back its own sale. */
export const UNDO_MINUTES = 10

export function listProducts(db: Db): Product[] {
  return db
    .select({
      id: products.id,
      name: products.name,
      productType: products.productType,
      quantity: products.quantity,
      price: products.price,
      sellingPrice: products.sellingPrice,
      sold: products.sold
    })
    .from(products)
    .orderBy(asc(sql`${products.name} collate nocase`))
    .all()
}

/** What an instructor's phone may see: no cost prices. */
export function staffProducts(db: Db): StaffProduct[] {
  return listProducts(db).map(({ id, name, productType, sellingPrice, quantity }) => ({
    id,
    name,
    productType,
    sellingPrice,
    quantity
  }))
}

export function createProduct(db: Db, raw: ProductInput): void {
  const input = productInput.parse(raw)
  db.insert(products).values({ id: randomUUID(), ...input, sold: 0 }).run()
}

export function updateProduct(db: Db, id: string, raw: ProductEditInput): void {
  const input = productEditInput.parse(raw)
  const result = db
    .update(products)
    .set({ ...input, updatedAt: nowUtc() })
    .where(eq(products.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That product no longer exists.')
}

/** Past sales keep their amount; they just lose the link to the product. */
export function deleteProducts(db: Db, ids: string[]): void {
  if (ids.length === 0) return
  db.delete(products).where(inArray(products.id, ids)).run()
}

/**
 * Returns the sale's payment id. A sale on credit isn't a payment (no money
 * came in): it's kept against the member, and its id is returned instead.
 */
export function sellProduct(db: Db, raw: SellInput, by?: Recorder): string {
  const input = sellInput.parse(raw)
  const id = randomUUID()
  db.transaction((tx) => {
    const product = tx.select().from(products).where(eq(products.id, input.productId)).get()
    if (!product) throw new AppError('That product no longer exists.')
    if (input.quantity > product.quantity) {
      throw new AppError(
        product.quantity === 0
          ? `${product.name} is out of stock.`
          : `Only ${product.quantity} ${product.name} left in stock.`
      )
    }
    if (input.memberId && !tx.select({ id: members.id }).from(members).where(eq(members.id, input.memberId)).get()) {
      throw new AppError('That member no longer exists. Choose them again.')
    }
    tx.update(products)
      .set({
        quantity: sql`${products.quantity} - ${input.quantity}`,
        sold: sql`${products.sold} + ${input.quantity}`,
        updatedAt: nowUtc()
      })
      .where(eq(products.id, product.id))
      .run()
    const sale = {
      id,
      productId: product.id,
      quantity: input.quantity,
      amount: product.sellingPrice * input.quantity,
      unitCost: product.price,
      recordedBy: by?.name ?? null,
      deviceId: by?.deviceId ?? null
    }
    if (input.paymentType === 'CREDIT') {
      tx.insert(creditSales)
        .values({ ...sale, memberId: input.memberId!, productName: product.name, soldAt: nowLocalIso() })
        .run()
      return
    }
    tx.insert(payments)
      .values({
        ...sale,
        paymentType: input.paymentType,
        category: product.productType,
        paidAt: nowLocalIso(),
        receiptNo: nextReceiptNo(tx),
        memberId: input.memberId ?? null
      })
      .run()
  })
  return id
}

function changeStock(
  db: Db,
  kind: StockChangeKind,
  productId: string,
  newQuantity: (current: number) => number,
  by?: Recorder
): StockResult {
  return db.transaction((tx) => {
    const product = tx.select().from(products).where(eq(products.id, productId)).get()
    if (!product) throw new AppError('That product no longer exists.')
    const after = newQuantity(product.quantity)
    tx.update(products).set({ quantity: after, updatedAt: nowUtc() }).where(eq(products.id, product.id)).run()
    tx.insert(stockChanges)
      .values({
        id: randomUUID(),
        productId: product.id,
        kind,
        change: after - product.quantity,
        quantityAfter: after,
        recordedBy: by?.name ?? null,
        deviceId: by?.deviceId ?? null,
        changedAt: nowLocalIso()
      })
      .run()
    return { productName: product.name, change: after - product.quantity, quantityAfter: after }
  })
}

/** A delivery: added to what's in stock now, so a sale made meanwhile still counts. */
export function receiveStock(db: Db, raw: StockInput, by?: Recorder): StockResult {
  const input = stockReceivedInput.parse(raw)
  return changeStock(db, 'RECEIVED', input.productId, (current) => current + input.quantity, by)
}

/** After counting the shelf: the stock becomes what's there, and the difference is kept. */
export function countStock(db: Db, raw: StockInput, by?: Recorder): StockResult {
  const input = stockCountInput.parse(raw)
  return changeStock(db, 'COUNT', input.productId, () => input.quantity, by)
}

export function listStockChanges(db: Db, raw: DateRangeInput): StockChange[] {
  const range = dateRangeInput.parse(raw)
  return db.all<StockChange>(sql`
    select s.id, s.product_id as productId, p.name as productName, s.kind, s.change,
      s.quantity_after as quantityAfter, s.recorded_by as recordedBy, s.changed_at as changedAt
    from stock_changes s join products p on p.id = s.product_id
    where substr(s.changed_at, 1, 10) between ${range.from} and ${range.to}
    order by s.changed_at desc`)
}

const undoSecondsLeft = (paidAt: string): number =>
  // paidAt is local time, which Date reads as such.
  Math.max(0, Math.floor((new Date(paidAt).getTime() + UNDO_MINUTES * 60_000 - Date.now()) / 1000))

/** Sales paid for and sales on credit, as one list; `where` filters on s.id, s.deviceId and s.paidAt. */
function staffSales(db: Db, where: SQL): StaffSale[] {
  return db
    .all<Omit<StaffSale, 'undoSecondsLeft'>>(sql`
      select s.id, s.paidAt, s.productName, s.quantity, s.amount, s.paymentType, s.memberName from (
        select p.id, p.device_id as deviceId, p.paid_at as paidAt, p.created_at as createdAt,
          coalesce(pr.name, 'Deleted product') as productName, coalesce(p.quantity, 1) as quantity, p.amount,
          p.payment_type as paymentType, trim(m.first_name || ' ' || m.last_name) as memberName
        from payments p
        left join products pr on pr.id = p.product_id
        left join members m on m.id = p.member_id
        union all
        select c.id, c.device_id, c.sold_at, c.sold_at, c.product_name, c.quantity, c.amount,
          'CREDIT', trim(m.first_name || ' ' || m.last_name)
        from credit_sales c join members m on m.id = c.member_id
      ) s
      where ${where}
      order by s.paidAt desc, s.createdAt desc`)
    .map((s) => ({ ...s, undoSecondsLeft: undoSecondsLeft(s.paidAt) }))
}

export function staffSale(db: Db, id: string): StaffSale {
  const sale = staffSales(db, sql`s.id = ${id}`)[0]
  if (!sale) throw new AppError('That sale no longer exists.')
  return sale
}

/** One phone's sales today, newest first. */
export function deviceSalesToday(db: Db, deviceId: string): StaffSale[] {
  return staffSales(db, sql`s.deviceId = ${deviceId} and substr(s.paidAt, 1, 10) = ${todayIso()}`)
}

/** A phone takes back its own sale, for a few minutes after; the items go back into stock. */
export function undoSale(db: Db, id: string, deviceId: string): StaffSale {
  const sale = staffSales(db, sql`s.id = ${id} and s.deviceId = ${deviceId}`)[0]
  if (!sale) throw new AppError('That sale wasn’t recorded on this phone.')
  if (sale.undoSecondsLeft === 0) {
    throw new AppError(`It’s over ${UNDO_MINUTES} minutes since that sale. Ask the front desk to delete it.`)
  }
  if (sale.paymentType === 'CREDIT') deleteCreditSale(db, id)
  else deletePayment(db, id)
  return sale
}

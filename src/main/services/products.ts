import { randomUUID } from 'node:crypto'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Product } from '../../shared/api'
import { nowLocalIso } from '../../shared/dates'
import { productInput, sellInput, type ProductInput, type SellInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { payments, products } from '../db/schema'
import { AppError, nowUtc } from './errors'
import { nextReceiptNo } from './payments'

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

export function createProduct(db: Db, raw: ProductInput): void {
  const input = productInput.parse(raw)
  db.insert(products).values({ id: randomUUID(), ...input, sold: 0 }).run()
}

export function updateProduct(db: Db, id: string, raw: ProductInput): void {
  const input = productInput.parse(raw)
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

/** Returns the sale's payment id. */
export function sellProduct(db: Db, raw: SellInput): string {
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
    tx.update(products)
      .set({
        quantity: product.quantity - input.quantity,
        sold: product.sold + input.quantity,
        updatedAt: nowUtc()
      })
      .where(eq(products.id, product.id))
      .run()
    tx.insert(payments)
      .values({
        id,
        productId: product.id,
        quantity: input.quantity,
        amount: product.sellingPrice * input.quantity,
        paymentType: input.paymentType,
        category: product.productType,
        paidAt: nowLocalIso(),
        receiptNo: nextReceiptNo(tx)
      })
      .run()
  })
  return id
}

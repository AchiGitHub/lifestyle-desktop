import { randomUUID } from 'node:crypto'
import { eq, sql, type SQL } from 'drizzle-orm'
import type { Payment } from '../../shared/api'
import { nowLocalIso } from '../../shared/dates'
import { PAYMENT_CATEGORY_LABELS, type PaymentCategory, type PaymentType } from '../../shared/enums'
import { paymentAddInput, paymentFilterInput, type PaymentAddInput, type PaymentFilterInput } from '../../shared/schemas'
import type { Db, Executor } from '../db/client'
import { payments, products, registrations } from '../db/schema'
import { AppError, nowUtc } from './errors'
import { putSetting, readSettings } from './settings'

const LAST_RECEIPT_KEY = 'receipts.lastNumber'

const highestReceiptNo = (db: Executor): number =>
  db.get<{ n: number }>(sql`select coalesce(max(receipt_no), 0) as n from payments`)!.n

/**
 * The next receipt number. Call it inside the transaction that inserts the
 * payment. The last number issued is remembered, so deleting the newest
 * payment never lets its number be used again.
 */
export function nextReceiptNo(db: Executor): number {
  const last = Number(readSettings(db, [LAST_RECEIPT_KEY]).get(LAST_RECEIPT_KEY) ?? 0)
  const next = Math.max(last, highestReceiptNo(db)) + 1
  putSetting(db, LAST_RECEIPT_KEY, String(next))
  return next
}

/**
 * Numbers payments that have no receipt number, in date order, after the
 * highest existing one. Same order as the 0002 migration's backfill.
 */
export function numberReceipts(db: Executor): void {
  const start = highestReceiptNo(db)
  db.run(sql`update payments set receipt_no = numbered.n + ${start}
    from (select id, row_number() over (order by paid_at, created_at, id) as n
          from payments where receipt_no is null) as numbered
    where numbered.id = payments.id`)
}

interface PaymentRow {
  id: string
  registrationId: string | null
  legacyRegistrationId: string | null
  productId: string | null
  quantity: number | null
  amount: number
  paymentType: PaymentType
  category: PaymentCategory
  paidAt: string | null
  receiptNo: number | null
  memberId: string | null
  memberName: string | null
  recordedBy: string | null
  registrationName: string | null
  memberNames: string | null
  productName: string | null
  ptPackageName: string | null
}

function describe(p: PaymentRow): string {
  if (p.registrationId) return p.memberNames || p.registrationName || 'Membership fee'
  if (p.legacyRegistrationId) return 'Membership fee (registration deleted)'
  if (p.ptPackageName) return `Personal training: ${p.ptPackageName}`
  if (p.productName) return p.quantity ? `${p.productName} × ${p.quantity}` : p.productName
  if (p.category === 'STORE_CREDIT') return 'Store items on credit'
  return PAYMENT_CATEGORY_LABELS[p.category]
}

export function loadPayments(db: Db, where: SQL): Payment[] {
  const rows = db.all<PaymentRow>(sql`
    select p.id, p.registration_id as registrationId, p.legacy_registration_id as legacyRegistrationId,
      p.product_id as productId, p.quantity, p.amount, p.payment_type as paymentType, p.category,
      p.paid_at as paidAt, p.receipt_no as receiptNo, p.recorded_by as recordedBy,
      p.member_id as memberId, trim(buyer.first_name || ' ' || buyer.last_name) as memberName,
      r.name as registrationName, pr.name as productName, pt.package_name as ptPackageName,
      (select group_concat(trim(m.first_name || ' ' || m.last_name), ', ')
         from registration_members rm join members m on m.id = rm.member_id
         where rm.registration_id = p.registration_id) as memberNames
    from payments p
    left join registrations r on r.id = p.registration_id
    left join products pr on pr.id = p.product_id
    left join pt_registrations pt on pt.id = p.pt_registration_id
    left join members buyer on buyer.id = p.member_id
    where ${where}
    order by p.paid_at desc, p.created_at desc`)
  return rows.map((p) => ({
    id: p.id,
    registrationId: p.registrationId,
    legacyRegistrationId: p.legacyRegistrationId,
    productId: p.productId,
    quantity: p.quantity,
    amount: p.amount,
    paymentType: p.paymentType,
    category: p.category,
    paidAt: p.paidAt,
    description: describe(p),
    receiptNo: p.receiptNo,
    memberId: p.memberId,
    memberName: p.memberName,
    recordedBy: p.recordedBy
  }))
}

export function listPayments(db: Db, raw: PaymentFilterInput): Payment[] {
  const f = paymentFilterInput.parse(raw)
  const conditions: SQL[] = [sql`substr(p.paid_at, 1, 10) between ${f.from} and ${f.to}`]
  if (f.categories && f.categories.length > 0) {
    conditions.push(sql`p.category in (${sql.join(f.categories.map((c) => sql`${c}`), sql`, `)})`)
  }
  if (f.paymentType) conditions.push(sql`p.payment_type = ${f.paymentType}`)
  return loadPayments(db, sql.join(conditions, sql` and `))
}

/** Their membership payments and the store items they bought. */
export function paymentsForMember(db: Db, memberId: string): Payment[] {
  return loadPayments(
    db,
    sql`(p.registration_id in (select registration_id from registration_members where member_id = ${memberId})
      or p.member_id = ${memberId})`
  )
}

/** Returns the new payment's id. */
export function addPayment(db: Db, raw: PaymentAddInput): string {
  const input = paymentAddInput.parse(raw)
  const registration = db.select().from(registrations).where(eq(registrations.id, input.registrationId)).get()
  if (!registration) throw new AppError('That registration no longer exists.')
  const id = randomUUID()
  db.transaction((tx) => {
    tx.insert(payments)
      .values({
        id,
        registrationId: registration.id,
        amount: input.amount,
        paymentType: input.paymentType,
        category: 'MEMBERSHIP',
        paidAt: nowLocalIso(),
        receiptNo: nextReceiptNo(tx)
      })
      .run()
  })
  return id
}

/** Deleting a store sale puts the items back in stock. */
export function deletePayment(db: Db, id: string): void {
  db.transaction((tx) => {
    const payment = tx.select().from(payments).where(eq(payments.id, id)).get()
    if (!payment) return
    if (payment.productId && payment.quantity) {
      tx.update(products)
        .set({
          quantity: sql`${products.quantity} + ${payment.quantity}`,
          sold: sql`max(${products.sold} - ${payment.quantity}, 0)`,
          updatedAt: nowUtc()
        })
        .where(eq(products.id, payment.productId))
        .run()
    }
    tx.delete(payments).where(eq(payments.id, id)).run()
  })
}

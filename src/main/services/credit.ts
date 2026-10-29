import { randomUUID } from 'node:crypto'
import { eq, sql, type SQL } from 'drizzle-orm'
import type { CreditSale, MemberCredit } from '../../shared/api'
import { nowLocalIso } from '../../shared/dates'
import { rupees } from '../../shared/format'
import { creditPaymentInput, dateRangeInput, type CreditPaymentInput, type DateRangeInput } from '../../shared/schemas'
import type { Db, Executor } from '../db/client'
import { creditReminders, creditSales, members, payments, products } from '../db/schema'
import { AppError, nowUtc } from './errors'
import { nextReceiptNo } from './payments'

const money = (value: number): number => Math.round(value * 100) / 100
// Amounts are stored as reals; anything under a cent is rounding.
const CENT = 0.005

type SaleRow = Omit<CreditSale, 'owed'>

function saleRows(db: Executor, where: SQL): SaleRow[] {
  return db.all<SaleRow>(sql`
    select c.id, c.member_id as memberId, trim(m.first_name || ' ' || m.last_name) as memberName,
      c.product_name as productName, c.quantity, c.amount, c.sold_at as soldAt, c.recorded_by as recordedBy
    from credit_sales c join members m on m.id = c.member_id
    where ${where}
    order by c.sold_at, c.id`)
}

/** What each member has paid towards store credit. */
function paidByMember(db: Executor, where: SQL = sql`1`): Map<string, number> {
  const rows = db.all<{ memberId: string; paid: number }>(sql`
    select member_id as memberId, sum(amount) as paid from payments
    where category = 'STORE_CREDIT' and member_id is not null and ${where}
    group by member_id`)
  return new Map(rows.map((r) => [r.memberId, r.paid]))
}

/** Spreads what a member has paid over their items, oldest first. */
function settle(sales: SaleRow[], paid: number): CreditSale[] {
  let left = paid
  return sales.map((s) => {
    const covered = Math.min(s.amount, Math.max(left, 0))
    left -= covered
    return { ...s, owed: money(s.amount - covered) }
  })
}

/** Taken on credit less paid, never below nothing. */
export function owedBy(db: Executor, memberId: string): number {
  const { taken } = db.get<{ taken: number }>(
    sql`select coalesce(sum(amount), 0) as taken from credit_sales where member_id = ${memberId}`
  )!
  return Math.max(0, money(taken - (paidByMember(db, sql`member_id = ${memberId}`).get(memberId) ?? 0)))
}

export function memberCredit(db: Db, memberId: string): MemberCredit {
  const member = db
    .select({ firstName: members.firstName, lastName: members.lastName, mobileNumber: members.mobileNumber })
    .from(members)
    .where(eq(members.id, memberId))
    .get()
  if (!member) throw new AppError('That member no longer exists.')
  const paid = paidByMember(db, sql`member_id = ${memberId}`).get(memberId) ?? 0
  const items = settle(saleRows(db, sql`c.member_id = ${memberId}`), paid).filter((s) => s.owed > CENT)
  const dates = db.get<{ remindedAt: string | null; lastPaidAt: string | null }>(sql`
    select (select max(sent_at) from credit_reminders where member_id = ${memberId}) as remindedAt,
      (select max(paid_at) from payments where member_id = ${memberId} and category = 'STORE_CREDIT') as lastPaidAt`)!
  return {
    memberId,
    ...member,
    owed: owedBy(db, memberId),
    items,
    remindedAt: dates.remindedAt,
    lastPaidAt: dates.lastPaidAt
  }
}

/** Everyone who owes for store items, most owed first. */
export function owedList(db: Db): MemberCredit[] {
  const ids = db.all<{ id: string }>(sql`
    select c.member_id as id from credit_sales c
    group by c.member_id
    having sum(c.amount) - coalesce((select sum(p.amount) from payments p
      where p.member_id = c.member_id and p.category = 'STORE_CREDIT'), 0) > ${CENT}`)
  return ids.map((r) => memberCredit(db, r.id)).sort((a, b) => b.owed - a.owed)
}

/** Items taken on credit in a date range, newest first, with what's still to pay on each. */
export function listCreditSales(db: Db, raw: DateRangeInput): CreditSale[] {
  const range = dateRangeInput.parse(raw)
  const inRange = saleRows(db, sql`substr(c.sold_at, 1, 10) between ${range.from} and ${range.to}`)
  // What's left on an item depends on the member's earlier items too.
  const ids = [...new Set(inRange.map((s) => s.memberId))]
  const paid = paidByMember(db)
  const owed = new Map<string, number>()
  for (const memberId of ids) {
    for (const s of settle(saleRows(db, sql`c.member_id = ${memberId}`), paid.get(memberId) ?? 0)) owed.set(s.id, s.owed)
  }
  return inRange.map((s) => ({ ...s, owed: owed.get(s.id) ?? 0 })).reverse()
}

/** Returns the payment's id, for its receipt. */
export function payCredit(db: Db, raw: CreditPaymentInput): string {
  const input = creditPaymentInput.parse(raw)
  const id = randomUUID()
  db.transaction((tx) => {
    const owed = owedBy(tx, input.memberId)
    if (owed <= CENT) throw new AppError('They don’t owe anything for store items.')
    if (input.amount > owed + CENT) throw new AppError(`They only owe ${rupees(owed)}.`)
    tx.insert(payments)
      .values({
        id,
        amount: input.amount,
        paymentType: input.paymentType,
        category: 'STORE_CREDIT',
        paidAt: nowLocalIso(),
        receiptNo: nextReceiptNo(tx),
        memberId: input.memberId
      })
      .run()
  })
  return id
}

/**
 * For an item entered by mistake: it comes off what they owe and goes back
 * into stock. What they've paid stays paid, towards their other items; so not
 * when it's more than they still owe, as part of their money would be left over.
 */
export function deleteCreditSale(db: Db, id: string): void {
  db.transaction((tx) => {
    const sale = tx.select().from(creditSales).where(eq(creditSales.id, id)).get()
    if (!sale) return
    const owed = owedBy(tx, sale.memberId)
    if (sale.amount > owed + CENT) {
      throw new AppError(
        `They only owe ${rupees(owed)}, so without this they’d have paid too much. Delete their store credit payment under Payments first, then this.`
      )
    }
    if (sale.productId) {
      tx.update(products)
        .set({
          quantity: sql`${products.quantity} + ${sale.quantity}`,
          sold: sql`max(${products.sold} - ${sale.quantity}, 0)`,
          updatedAt: nowUtc()
        })
        .where(eq(products.id, sale.productId))
        .run()
    }
    tx.delete(creditSales).where(eq(creditSales.id, id)).run()
  })
}

export function recordCreditReminder(db: Db, memberId: string): void {
  db.insert(creditReminders).values({ id: randomUUID(), memberId, sentAt: nowUtc() }).run()
}

/**
 * Where a member's store credit stood right after a payment towards it, so a
 * reprinted receipt reads the same as the first time.
 */
export function owedAfterPayment(db: Db, payment: { memberId: string; paidAt: string; receiptNo: number }): number {
  const { taken, paid } = db.get<{ taken: number; paid: number }>(sql`
    select
      (select coalesce(sum(amount), 0) from credit_sales
        where member_id = ${payment.memberId} and sold_at <= ${payment.paidAt}) as taken,
      (select coalesce(sum(amount), 0) from payments
        where member_id = ${payment.memberId} and category = 'STORE_CREDIT' and receipt_no <= ${payment.receiptNo}) as paid`)!
  return Math.max(0, money(taken - paid))
}

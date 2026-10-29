import { sql } from 'drizzle-orm'
import type { DaySummary, ReceiptSettings } from '../../shared/api'
import { nowLocalIso, shiftMonth } from '../../shared/dates'
import {
  PAYMENT_CATEGORIES,
  PAYMENT_CATEGORY_LABELS,
  PAYMENT_TYPES,
  PRODUCT_TYPE_LABELS,
  type PaymentCategory,
  type PaymentType,
  type ProductType
} from '../../shared/enums'
import { dateRangeInput, type DateRangeInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { receiptSettings } from './receipts'
import { loadRegistrations } from './registrations'
import { daySummaries } from './summary'
import { loadPtRegistrations } from './training'

const money = (value: number): number => Math.round(value * 100) / 100
const CENT = 0.005

/** One receipt in the period. */
export interface PaymentLine {
  paidAt: string
  receiptNo: number | null
  /** Member names; "Walk-in" for a store sale to someone who isn't a member. */
  from: string
  /** What it was for: "Membership: One Month", "Yeti Isotonic × 2", … */
  for: string
  category: PaymentCategory
  method: PaymentType
  amount: number
  /** The instructor who recorded it on their phone; null at the front desk. */
  recordedBy: string | null
}

/** Takings in one month of the period. */
export interface MonthLine {
  month: string
  memberships: number
  personalTraining: number
  store: number
  storeCredit: number
  total: number
  byMethod: Record<PaymentType, number>
}

/** An item sold in the period, paid for or on credit. */
export interface StoreLine {
  soldAt: string
  /** Paid sales only. */
  receiptNo: number | null
  productName: string
  productType: ProductType | null
  quantity: number
  unitPrice: number
  amount: number
  unitCost: number | null
  /** Where the cost came from: kept with the sale, or today's cost price. */
  costFrom: 'SALE' | 'CURRENT' | 'UNKNOWN'
  cost: number | null
  /** A payment method, or on credit (not yet income). */
  method: PaymentType | 'CREDIT'
  buyer: string | null
}

export interface ProductLine {
  productName: string
  quantity: number
  sales: number
  cost: number | null
}

export interface MembershipSale {
  startDate: string
  endDate: string
  plan: string
  members: string
  amount: number
  joiningFee: number
  paidByEnd: number
  owedAtEnd: number
}

export interface TrainingSale {
  startDate: string
  member: string
  trainer: string
  trainerIsOwner: boolean
  packageName: string
  sessions: number
  amount: number
  paidByEnd: number
  owedAtEnd: number
  commission: number
}

export interface TrainerTotal {
  trainer: string
  isOwner: boolean
  packages: number
  sales: number
  commission: number
}

export interface OwedLine {
  kind: 'MEMBERSHIP' | 'PERSONAL_TRAINING' | 'STORE_CREDIT'
  member: string
  for: string
  /** When the oldest unpaid part started. */
  since: string
  owed: number
}

export interface StockLine {
  productName: string
  productType: ProductType
  costPrice: number
  /** Worked back from today; 0 for a product added after the period. */
  atEnd: number
  now: number
}

export interface AccountsReport {
  from: string
  to: string
  generatedAt: string
  gym: ReceiptSettings
  payments: PaymentLine[]
  total: number
  byCategory: Record<PaymentCategory, number>
  byMethod: Record<PaymentType, { count: number; total: number }>
  receipts: { first: number | null; last: number | null; missing: number[] }
  months: MonthLine[]
  /** Oldest first. */
  days: DaySummary[]
  store: StoreLine[]
  products: ProductLine[]
  memberships: MembershipSale[]
  training: TrainingSale[]
  trainers: TrainerTotal[]
  owed: OwedLine[]
  stock: StockLine[]
  /** The first delivery or count on record: stock before it may be off. */
  stockLoggedFrom: string | null
  /** Old imported payments without a date, which no period includes. */
  undated: number
  /** Membership payments in the period whose registration was deleted in the old system. */
  deletedRegistrations: { count: number; total: number }
}

const STORE: PaymentCategory[] = ['SUPPLEMENT', 'BEVERAGE', 'OTHER']

interface PaymentRow {
  paidAt: string
  receiptNo: number | null
  category: PaymentCategory
  method: PaymentType
  amount: number
  recordedBy: string | null
  quantity: number | null
  registrationId: string | null
  legacy: string | null
  planName: string | null
  productName: string | null
  ptPackage: string | null
  trainerName: string | null
  buyerName: string | null
  memberNames: string | null
}

function paymentFor(p: PaymentRow): string {
  if (p.registrationId) return `Membership: ${p.planName ?? 'plan'}`
  if (p.legacy) return 'Membership fee (registration deleted)'
  if (p.ptPackage) return `Personal training: ${p.ptPackage}${p.trainerName ? ` with ${p.trainerName}` : ''}`
  if (p.category === 'STORE_CREDIT') return 'Store items on credit'
  if (STORE.includes(p.category)) return `${p.productName ?? PAYMENT_CATEGORY_LABELS[p.category]}${p.quantity ? ` × ${p.quantity}` : ''}`
  return PAYMENT_CATEGORY_LABELS[p.category]
}

function paymentLines(db: Db, from: string, to: string): PaymentLine[] {
  return db
    .all<PaymentRow>(sql`
      select p.paid_at as paidAt, p.receipt_no as receiptNo, p.category, p.payment_type as method, p.amount,
        p.recorded_by as recordedBy, p.quantity, p.registration_id as registrationId,
        p.legacy_registration_id as legacy, mt.name as planName, pr.name as productName,
        pt.package_name as ptPackage, t.name as trainerName,
        trim(buyer.first_name || ' ' || buyer.last_name) as buyerName,
        (select group_concat(trim(m.first_name || ' ' || m.last_name), ', ')
           from registration_members rm join members m on m.id = rm.member_id
           where rm.registration_id = p.registration_id) as memberNames
      from payments p
      left join registrations r on r.id = p.registration_id
      left join membership_types mt on mt.id = r.membership_type_id
      left join products pr on pr.id = p.product_id
      left join pt_registrations pt on pt.id = p.pt_registration_id
      left join trainers t on t.id = pt.trainer_id
      left join members buyer on buyer.id = p.member_id
      where substr(p.paid_at, 1, 10) between ${from} and ${to}
      order by p.paid_at, p.receipt_no`)
    .map((p) => ({
      paidAt: p.paidAt,
      receiptNo: p.receiptNo,
      from: p.memberNames || p.buyerName || (STORE.includes(p.category) ? 'Walk-in' : ''),
      for: paymentFor(p),
      category: p.category,
      method: p.method,
      amount: p.amount,
      recordedBy: p.recordedBy
    }))
}

/** Receipt numbers between the period's first and last that no payment has: deleted to fix mistakes. */
function missingReceipts(db: Db, first: number | null, last: number | null): number[] {
  if (first === null || last === null) return []
  const used = new Set(
    db
      .all<{ n: number }>(sql`select receipt_no as n from payments where receipt_no between ${first} and ${last}`)
      .map((r) => r.n)
  )
  const missing: number[] = []
  for (let n = first; n <= last; n++) if (!used.has(n)) missing.push(n)
  return missing
}

function months(from: string, to: string, payments: PaymentLine[]): MonthLine[] {
  const lines: MonthLine[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
    const inMonth = payments.filter((p) => p.paidAt.startsWith(m))
    const sum = (f: (p: PaymentLine) => boolean) => money(inMonth.filter(f).reduce((s, p) => s + p.amount, 0))
    lines.push({
      month: m,
      memberships: sum((p) => p.category === 'MEMBERSHIP'),
      personalTraining: sum((p) => p.category === 'PERSONAL_TRAINING'),
      store: sum((p) => STORE.includes(p.category)),
      storeCredit: sum((p) => p.category === 'STORE_CREDIT'),
      total: sum(() => true),
      byMethod: Object.fromEntries(PAYMENT_TYPES.map((t) => [t, sum((p) => p.method === t)])) as Record<PaymentType, number>
    })
  }
  return lines
}

interface StoreRow {
  soldAt: string
  receiptNo: number | null
  productName: string | null
  productType: ProductType | null
  quantity: number | null
  amount: number
  unitCost: number | null
  currentCost: number | null
  method: PaymentType | 'CREDIT'
  buyer: string | null
}

function storeLines(db: Db, from: string, to: string): StoreLine[] {
  const rows = db.all<StoreRow>(sql`
    select * from (
      select p.paid_at as soldAt, p.receipt_no as receiptNo, coalesce(pr.name, case when p.product_id is null then null else 'Deleted product' end) as productName,
        coalesce(pr.product_type, p.category) as productType, p.quantity, p.amount, p.unit_cost as unitCost,
        pr.price as currentCost, p.payment_type as method, trim(m.first_name || ' ' || m.last_name) as buyer
      from payments p
      left join products pr on pr.id = p.product_id
      left join members m on m.id = p.member_id
      where p.category in ('SUPPLEMENT', 'BEVERAGE', 'OTHER') and substr(p.paid_at, 1, 10) between ${from} and ${to}
      union all
      select c.sold_at, null, c.product_name, pr.product_type, c.quantity, c.amount, c.unit_cost,
        pr.price, 'CREDIT', trim(m.first_name || ' ' || m.last_name)
      from credit_sales c
      left join products pr on pr.id = c.product_id
      join members m on m.id = c.member_id
      where substr(c.sold_at, 1, 10) between ${from} and ${to}
    ) order by soldAt`)
  return rows.map((r) => {
    const quantity = r.quantity ?? 1
    const unitCost = r.unitCost ?? r.currentCost
    return {
      soldAt: r.soldAt,
      receiptNo: r.receiptNo,
      productName: r.productName ?? PAYMENT_CATEGORY_LABELS[r.productType as PaymentCategory] ?? 'Other sale',
      productType: r.productType && r.productType in PRODUCT_TYPE_LABELS ? r.productType : null,
      quantity,
      unitPrice: money(r.amount / quantity),
      amount: r.amount,
      unitCost,
      costFrom: r.unitCost !== null ? 'SALE' : r.currentCost !== null ? 'CURRENT' : 'UNKNOWN',
      cost: unitCost === null ? null : money(unitCost * quantity),
      method: r.method,
      buyer: r.buyer || (r.method === 'CREDIT' ? null : 'Walk-in')
    }
  })
}

function productLines(store: StoreLine[]): ProductLine[] {
  const byName = new Map<string, ProductLine>()
  for (const s of store) {
    const line = byName.get(s.productName) ?? { productName: s.productName, quantity: 0, sales: 0, cost: 0 }
    line.quantity += s.quantity
    line.sales = money(line.sales + s.amount)
    line.cost = line.cost === null || s.cost === null ? null : money(line.cost + s.cost)
    byName.set(s.productName, line)
  }
  return [...byName.values()].sort((a, b) => b.sales - a.sales)
}

/** Paid on a registration or package up to the end of the period. Undated old payments count as paid. */
const paidByEnd = (db: Db, column: 'registration_id' | 'pt_registration_id', id: string, to: string): number =>
  db.get<{ paid: number }>(sql`
    select coalesce(sum(amount), 0) as paid from payments
    where ${sql.raw(column)} = ${id} and (paid_at is null or substr(paid_at, 1, 10) <= ${to})`)!.paid

function membershipSales(db: Db, from: string, to: string): MembershipSale[] {
  return loadRegistrations(db, sql`r.start_date between ${from} and ${to}`)
    .reverse()
    .map((r) => {
      const paid = paidByEnd(db, 'registration_id', r.id, to)
      return {
        startDate: r.startDate,
        endDate: r.endDate,
        plan: r.membershipTypeName,
        members: r.members.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', '),
        amount: r.amount,
        joiningFee: r.joiningFee,
        paidByEnd: money(paid),
        owedAtEnd: Math.max(0, money(r.amount - paid))
      }
    })
}

function trainingSales(db: Db, from: string, to: string): TrainingSale[] {
  return loadPtRegistrations(db, sql`p.start_date between ${from} and ${to}`)
    .reverse()
    .map((p) => {
      const paid = paidByEnd(db, 'pt_registration_id', p.id, to)
      return {
        startDate: p.startDate,
        member: p.memberName,
        trainer: p.trainerName,
        trainerIsOwner: p.trainerIsOwner,
        packageName: p.packageName,
        sessions: p.sessions,
        amount: p.amount,
        paidByEnd: money(paid),
        owedAtEnd: Math.max(0, money(p.amount - paid)),
        commission: p.commission
      }
    })
}

function trainerTotals(training: TrainingSale[]): TrainerTotal[] {
  const byTrainer = new Map<string, TrainerTotal>()
  for (const t of training) {
    const total = byTrainer.get(t.trainer) ?? { trainer: t.trainer, isOwner: t.trainerIsOwner, packages: 0, sales: 0, commission: 0 }
    total.packages++
    total.sales = money(total.sales + t.amount)
    total.commission = money(total.commission + t.commission)
    byTrainer.set(t.trainer, total)
  }
  return [...byTrainer.values()]
}

/** Everything still owed at the end of the last day, as the payments stood then. */
function owedAtEnd(db: Db, to: string): OwedLine[] {
  const owed: OwedLine[] = []
  for (const r of loadRegistrations(db, sql`r.start_date <= ${to}`).reverse()) {
    const left = money(r.amount - paidByEnd(db, 'registration_id', r.id, to))
    if (left > CENT) {
      owed.push({
        kind: 'MEMBERSHIP',
        member: r.members.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ') || r.name,
        for: `${r.membershipTypeName} (${r.startDate} to ${r.endDate})`,
        since: r.startDate,
        owed: left
      })
    }
  }
  for (const p of loadPtRegistrations(db, sql`p.start_date <= ${to}`).reverse()) {
    const left = money(p.amount - paidByEnd(db, 'pt_registration_id', p.id, to))
    if (left > CENT) {
      owed.push({ kind: 'PERSONAL_TRAINING', member: p.memberName, for: `${p.packageName} with ${p.trainerName}`, since: p.startDate, owed: left })
    }
  }
  // Store credit: items taken by the end less what was paid by then, oldest items paid off first.
  const sales = db.all<{ memberId: string; member: string; soldAt: string; amount: number }>(sql`
    select c.member_id as memberId, trim(m.first_name || ' ' || m.last_name) as member, c.sold_at as soldAt, c.amount
    from credit_sales c join members m on m.id = c.member_id
    where substr(c.sold_at, 1, 10) <= ${to}
    order by c.sold_at, c.id`)
  const paid = new Map(
    db
      .all<{ memberId: string; paid: number }>(sql`
        select member_id as memberId, sum(amount) as paid from payments
        where category = 'STORE_CREDIT' and member_id is not null and substr(paid_at, 1, 10) <= ${to}
        group by member_id`)
      .map((r) => [r.memberId, r.paid])
  )
  const byMember = new Map<string, typeof sales>()
  for (const s of sales) byMember.set(s.memberId, [...(byMember.get(s.memberId) ?? []), s])
  for (const [memberId, items] of byMember) {
    let left = paid.get(memberId) ?? 0
    const unpaid = items.filter((i) => {
      const covered = Math.min(i.amount, Math.max(left, 0))
      left -= covered
      return i.amount - covered > CENT
    })
    const total = money(items.reduce((s, i) => s + i.amount, 0) - (paid.get(memberId) ?? 0))
    if (total > CENT && unpaid.length > 0) {
      owed.push({ kind: 'STORE_CREDIT', member: items[0].member, for: 'Store items on credit', since: unpaid[0].soldAt.slice(0, 10), owed: total })
    }
  }
  return owed
}

/**
 * Stock at the end of the period, worked back from today: undo every delivery
 * and count logged since, and put back everything sold since.
 */
function stockLines(db: Db, to: string): { lines: StockLine[]; loggedFrom: string | null } {
  const after = (rows: { productId: string; n: number }[]) => new Map(rows.map((r) => [r.productId, r.n]))
  const changed = after(
    db.all(sql`select product_id as productId, sum(change) as n from stock_changes
      where substr(changed_at, 1, 10) > ${to} group by product_id`)
  )
  const sold = after(
    db.all(sql`select productId, sum(n) as n from (
        select product_id as productId, coalesce(quantity, 1) as n from payments
          where product_id is not null and substr(paid_at, 1, 10) > ${to}
        union all
        select product_id, quantity from credit_sales where product_id is not null and substr(sold_at, 1, 10) > ${to}
      ) group by productId`)
  )
  const lines = db
    .all<{ id: string; name: string; productType: ProductType; price: number; quantity: number; addedOn: string }>(sql`
      select id, name, product_type as productType, price, quantity, date(created_at, 'localtime') as addedOn
      from products order by name collate nocase`)
    .map((p) => ({
      productName: p.name,
      productType: p.productType,
      costPrice: p.price,
      atEnd: p.addedOn > to ? 0 : p.quantity - (changed.get(p.id) ?? 0) + (sold.get(p.id) ?? 0),
      now: p.quantity
    }))
  const first = db.get<{ at: string | null }>(sql`select min(changed_at) as at from stock_changes`)!.at
  return { lines, loggedFrom: first ? first.slice(0, 10) : null }
}

/** All the figures the accountant needs for a period. Income is money received in it. */
export function accountsReport(db: Db, raw: DateRangeInput, now = new Date()): AccountsReport {
  const { from, to } = dateRangeInput.parse(raw)
  const payments = paymentLines(db, from, to)
  const byCategory = Object.fromEntries(PAYMENT_CATEGORIES.map((c) => [c, 0])) as Record<PaymentCategory, number>
  const byMethod = Object.fromEntries(PAYMENT_TYPES.map((t) => [t, { count: 0, total: 0 }])) as AccountsReport['byMethod']
  for (const p of payments) {
    byCategory[p.category] = money(byCategory[p.category] + p.amount)
    byMethod[p.method].count++
    byMethod[p.method].total = money(byMethod[p.method].total + p.amount)
  }
  const numbers = payments.flatMap((p) => (p.receiptNo === null ? [] : [p.receiptNo]))
  const first = numbers.length ? Math.min(...numbers) : null
  const last = numbers.length ? Math.max(...numbers) : null
  const store = storeLines(db, from, to)
  const training = trainingSales(db, from, to)
  const stock = stockLines(db, to)
  return {
    from,
    to,
    generatedAt: nowLocalIso(now),
    gym: receiptSettings(db),
    payments,
    total: money(payments.reduce((s, p) => s + p.amount, 0)),
    byCategory,
    byMethod,
    receipts: { first, last, missing: missingReceipts(db, first, last) },
    months: months(from, to, payments),
    days: daySummaries(db, { from, to }).reverse(),
    store,
    products: productLines(store),
    memberships: membershipSales(db, from, to),
    training,
    trainers: trainerTotals(training),
    owed: owedAtEnd(db, to),
    stock: stock.lines,
    stockLoggedFrom: stock.loggedFrom,
    undated: db.get<{ n: number }>(sql`select count(*) as n from payments where paid_at is null`)!.n,
    deletedRegistrations: db.get<{ count: number; total: number }>(sql`
      select count(*) as count, coalesce(sum(amount), 0) as total from payments
      where registration_id is null and legacy_registration_id is not null
        and substr(paid_at, 1, 10) between ${from} and ${to}`)!
  }
}

/** "Lifestyle Fitness Studio accounts 2025-04-01 to 2026-03-31.xlsx", safe as a Windows file name. */
export function accountsFileName(gymName: string, from: string, to: string): string {
  const gym = gymName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Gym'
  return `${gym} accounts ${from} to ${to}.xlsx`
}

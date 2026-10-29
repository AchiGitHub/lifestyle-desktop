import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { membershipTypes, payments } from '../src/main/db/schema'
import { accountsWorkbook } from '../src/main/reports/workbook'
import { accountsFileName, accountsReport, type AccountsReport } from '../src/main/services/accounts'
import { payCredit } from '../src/main/services/credit'
import { addPayment, deletePayment } from '../src/main/services/payments'
import { receiveStock, sellProduct } from '../src/main/services/products'
import { createRegistration } from '../src/main/services/registrations'
import { createPtPackage, createPtRegistration, createTrainer, listPtPackages, listTrainers } from '../src/main/services/training'
import { taxYear } from '../src/shared/dates'
import { makeDb, seedMember, seedPlan, seedProduct } from './helpers'

let db: Db
let report: AccountsReport
let nimal: string
const at = (y: number, m: number, d: number, h = 10) => vi.setSystemTime(new Date(y, m - 1, d, h, 0))
const year = taxYear('2026-03-15')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  db = makeDb()
  nimal = seedMember(db, { firstName: 'Nimal', lastName: 'Perera', mobileNumber: '0771234567', nic: '199512345678' })
  const plan = seedPlan(db, { price: 10000 })
  db.update(membershipTypes).set({ name: 'One Month', joiningFee: 2000 }).where(eq(membershipTypes.id, plan)).run()
  const yeti = seedProduct(db, { quantity: 20, price: 245, sellingPrice: 350, createdAt: '2025-01-01T00:00:00.000Z' })

  // A sale from before costs were kept with each sale.
  at(2025, 6, 1)
  db.insert(payments)
    .values({ id: randomUUID(), productId: yeti, quantity: 1, amount: 350, paymentType: 'CASH', category: 'BEVERAGE', paidAt: '2025-06-01T09:00:00', receiptNo: 1 })
    .run()

  at(2026, 3, 10)
  const reg = createRegistration(db, {
    membershipTypeId: plan,
    startDate: '2026-03-10',
    endDate: '2026-04-09',
    amount: 10000,
    members: [{ kind: 'existing', memberId: nimal }],
    payment: { amount: 6000, paymentType: 'CASH' }
  })
  createTrainer(db, { name: 'Kasun', isOwner: false, commissionPercent: 30 })
  createPtPackage(db, { name: '12 sessions', sessions: 12, price: 24000, validDuration: 2, validDurationType: 'MONTH' })
  createPtRegistration(db, {
    memberId: nimal,
    trainerId: listTrainers(db)[0].id,
    packageId: listPtPackages(db)[0].id,
    sessions: 12,
    startDate: '2026-03-10',
    endDate: '2026-05-09',
    amount: 24000,
    commission: 7200,
    payment: { amount: 10000, paymentType: 'ONLINE' }
  })

  at(2026, 3, 12)
  sellProduct(db, { productId: yeti, quantity: 2, paymentType: 'CARD' }) // walk-in
  const mistake = sellProduct(db, { productId: yeti, quantity: 1, paymentType: 'CASH' })
  deletePayment(db, mistake)
  at(2026, 3, 15)
  sellProduct(db, { productId: yeti, quantity: 1, paymentType: 'CREDIT', memberId: nimal })
  at(2026, 3, 20)
  payCredit(db, { memberId: nimal, amount: 200, paymentType: 'CASH' })

  // After the year: none of this is in it, and the year-end figures don't change.
  at(2026, 4, 2)
  receiveStock(db, { productId: yeti, quantity: 5 })
  at(2026, 4, 3)
  sellProduct(db, { productId: yeti, quantity: 1, paymentType: 'CASH' })
  at(2026, 4, 5)
  addPayment(db, { registrationId: reg.id, amount: 6000, paymentType: 'CARD' })

  at(2026, 10, 29)
  report = accountsReport(db, year)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tax year', () => {
  it('runs 1 April to 31 March', () => {
    expect(taxYear('2026-03-31')).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(taxYear('2026-04-01')).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    expect(accountsFileName('Lifestyle: Fitness/Studio', '2025-04-01', '2026-03-31')).toBe(
      'Lifestyle FitnessStudio accounts 2025-04-01 to 2026-03-31.xlsx'
    )
  })
})

describe('accounts report', () => {
  it('counts money received in the period, by type and method', () => {
    expect(report.byCategory).toMatchObject({ MEMBERSHIP: 6000, PERSONAL_TRAINING: 10000, BEVERAGE: 1050, STORE_CREDIT: 200 })
    expect(report.total).toBe(17250)
    expect(report.deletedRegistrations).toEqual({ count: 0, total: 0 })
    expect(report.byMethod).toEqual({
      CASH: { count: 3, total: 6550 },
      CARD: { count: 1, total: 700 },
      ONLINE: { count: 1, total: 10000 }
    })
    expect(report.payments.map((p) => [p.from, p.for])).toEqual([
      ['Walk-in', 'Yeti Isotonic × 1'],
      ['Nimal Perera', 'Membership: One Month'],
      ['Nimal Perera', 'Personal training: 12 sessions with Kasun'],
      ['Walk-in', 'Yeti Isotonic × 2'],
      ['Nimal Perera', 'Store items on credit']
    ])
  })

  it('finds receipt numbers deleted to fix mistakes', () => {
    expect(report.receipts).toEqual({ first: 1, last: 6, missing: [5] })
  })

  it('has every month of the year, adding up to the total', () => {
    expect(report.months.map((m) => m.month)).toHaveLength(12)
    expect(report.months[0].month).toBe('2025-04')
    expect(report.months.at(-1)).toMatchObject({ month: '2026-03', memberships: 6000, personalTraining: 10000, store: 700, storeCredit: 200, total: 16900 })
    expect(report.months.reduce((s, m) => s + m.total, 0)).toBe(report.total)
    expect(report.days.reduce((s, d) => s + d.total, 0)).toBe(report.total)
  })

  it('costs store sales at the price kept with each sale, older ones at today’s price', () => {
    expect(report.store.map((s) => [s.soldAt.slice(0, 10), s.quantity, s.method, s.costFrom, s.cost])).toEqual([
      ['2025-06-01', 1, 'CASH', 'CURRENT', 245],
      ['2026-03-12', 2, 'CARD', 'SALE', 490],
      ['2026-03-15', 1, 'CREDIT', 'SALE', 245]
    ])
    expect(report.products).toEqual([{ productName: 'Yeti Isotonic', quantity: 4, sales: 1400, cost: 980 }])
  })

  it('shows sales made in the period with what was owed at its end, ignoring later payments', () => {
    expect(report.memberships).toEqual([
      expect.objectContaining({ plan: 'One Month', members: 'Nimal Perera', amount: 12000, joiningFee: 2000, paidByEnd: 6000, owedAtEnd: 6000 })
    ])
    expect(report.training).toEqual([expect.objectContaining({ trainer: 'Kasun', amount: 24000, paidByEnd: 10000, owedAtEnd: 14000, commission: 7200 })])
    expect(report.trainers).toEqual([{ trainer: 'Kasun', isOwner: false, packages: 1, sales: 24000, commission: 7200 }])
    expect(report.owed.map((o) => [o.kind, o.owed, o.since])).toEqual([
      ['MEMBERSHIP', 6000, '2026-03-10'],
      ['PERSONAL_TRAINING', 14000, '2026-03-10'],
      ['STORE_CREDIT', 150, '2026-03-15']
    ])
  })

  it('works stock back to the end of the period', () => {
    // 20, less 2 sold and 1 on credit = 17 at year end; then 5 delivered and 1 sold = 21 now.
    // (The 2025 sale is older than the stock figures, so it never moved them.)
    expect(report.stock).toEqual([expect.objectContaining({ productName: 'Yeti Isotonic', atEnd: 17, now: 21 })])
    expect(report.stockLoggedFrom).toBe('2026-04-02')
  })

  it('has no stock at the end of the period for a product added after it', () => {
    seedProduct(db, { name: 'Protein bar', quantity: 12, createdAt: '2026-05-01T00:00:00.000Z' })
    expect(accountsReport(db, year).stock.find((s) => s.productName === 'Protein bar')).toMatchObject({ atEnd: 0, now: 12 })
  })
})

describe('workbook', () => {
  it('has a sheet for each list, real dates, totals, and no phone or NIC numbers', async () => {
    const wb = new ExcelJS.Workbook()
    // ExcelJS types its own Buffer from before Node's became generic.
    await wb.xlsx.load((await accountsWorkbook(report, '1.2.0')) as unknown as ExcelJS.Buffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Monthly',
      'Daily takings',
      'Payments',
      'Store sales',
      'Store by product',
      'Memberships sold',
      'Personal training',
      'Owed at period end',
      'Stock'
    ])

    const summary = wb.getWorksheet('Summary')!
    const row = (label: string) => summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === label)!
    expect(row('Total income').getCell(2).value).toBe(17250)
    expect(row('Total owed').getCell(2).value).toBe(20150)
    expect(row('Missing receipt numbers').getCell(4).value).toMatch(/^R-00005: payments deleted/)

    const sheet = wb.getWorksheet('Payments')!
    expect(sheet.getRow(1).getCell(1).value).toBe('Date and time')
    expect(sheet.getCell('A2').value).toBeInstanceOf(Date)
    expect((sheet.getCell('A2').value as Date).toISOString()).toBe('2025-06-01T09:00:00.000Z')
    expect(sheet.getCell('G7').value).toMatchObject({ formula: 'SUM(G2:G6)', result: 17250 })
    expect(sheet.getCell('G2').numFmt).toBe('#,##0.00')
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })

    let text = ''
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => (text += ` ${String(c.value)}`))))
    expect(text).not.toMatch(/0771234567|771234567|199512345678/)
  })
})
